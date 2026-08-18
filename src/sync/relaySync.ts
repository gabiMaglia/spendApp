import { buildDelta, applyDelta, type SyncDelta } from './useSyncQR';
import { sealEnvelope, openEnvelope, deriveTopic } from './envelopeCrypto';
import { sendEnvelope, fetchSince } from './relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';

/**
 * Sync por el relay: arma el sobre cifrado, lo publica y aplica lo que llega.
 *
 * Es la unión de las tres piezas anteriores — buzón (`relay.ts`), cerradura
 * (`envelopeCrypto.ts`) y merge LWW (`useSyncQR.ts`) — con una regla que manda
 * sobre todo lo demás:
 *
 * **Por el relay NUNCA viaja una clave de grupo.** El delta del pairing QR sí
 * las lleva, porque ese canal está autenticado por presencia física. Éste no.
 * Si el relay pudiera entregar claves, podría sustituirlas y leer todo — es el
 * punto exacto donde estas arquitecturas se rompen (ADR-003 §1). Por eso el
 * payload se arma acá y no se reusa `buildDelta` tal cual.
 */

/**
 * Payload del relay: **sólo lo del grupo al que se publica**.
 *
 * Antes esto mandaba el delta entero menos las claves — o sea TODO el
 * dispositivo, cifrado con la clave de UN grupo. Cualquier miembro de ese grupo
 * podía abrirlo y quedarse con los otros grupos, sus gastos y los movimientos
 * personales de quien publicaba. Con dos cuentas del mismo dueño era invisible;
 * con gente real era una filtración, e imposible de revertir una vez que el
 * dato aterrizó en otro teléfono.
 *
 * Filtrar por grupo es además lo que baja el tamaño: el sobre pasa a ser una
 * fracción, y el techo de 256KB deja de estar a la vuelta de la esquina.
 *
 * Este objeto se arma campo por campo, no quitando lo prohibido. Es lo contrario
 * de lo que hacía antes, y es a propósito: no existe un filtro genérico "lo de
 * este grupo" — cada entidad se relaciona con el grupo de una forma distinta
 * (los comentarios cuelgan del gasto, los usuarios de la membresía). Enumerar
 * obliga a decidir. Para que agregar una entidad nueva no se olvide EN SILENCIO,
 * `relayScope.test.ts` compara las claves del delta contra esta lista y falla si
 * aparece una que nadie clasificó.
 */
export function buildGroupPayload(groupId: string, currentUserId: string): SyncDelta {
  const completo = buildDelta(currentUserId);

  const delGrupo = completo.groups.filter(g => g.id === groupId);
  const miembros = new Set(delGrupo[0]?.memberIds ?? []);

  const expenses = completo.expenses.filter(e => e.groupId === groupId);
  const idsDeGastos = new Set(expenses.map(e => e.id));

  return {
    version: completo.version,
    featureVersion: completo.featureVersion,
    fromUserId: completo.fromUserId,
    timestamp: completo.timestamp,

    groups: delGrupo,
    expenses,
    payments: completo.payments.filter(p => p.groupId === groupId),
    // Los perfiles de los miembros SÍ hacen falta: sin ellos el otro ve ids en
    // vez de nombres. Los de gente ajena al grupo, no.
    users: completo.users.filter(u => miembros.has(u.id)),
    recurring: (completo.recurring ?? []).filter(r => r.groupId === groupId),
    // Un comentario no sabe de qué grupo es: cuelga del gasto.
    comments: (completo.comments ?? []).filter(c => idsDeGastos.has(c.expenseId)),

    // `personal` NO viaja: son movimientos sin grupo, de nadie más que su dueño.
    // `groupKeys` tampoco: si el relay pudiera entregar claves podría
    // sustituirlas y leer todo (ADR-003 §1).
  };
}

export type PublishResult =
  | { ok: true; seq: number }
  | { ok: false; reason: 'no_key' | 'too_large' | 'not_configured' | 'network'; detail?: string };

/**
 * Publica el estado actual en el buzón del grupo, cifrado.
 * Sin la clave del grupo no se publica nada: mandar en claro "por esta vez"
 * es exactamente cómo se filtran los datos.
 */
export async function publishToGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
): Promise<PublishResult> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);
  const sealed = sealEnvelope(key, JSON.stringify(buildGroupPayload(groupId, currentUserId)));

  const r = await sendEnvelope(topic, sealed, deviceId);
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
  return { ok: true, seq: r.seq };
}

export type DrainResult =
  | { ok: true; applied: number; skipped: number; cursor: number }
  | { ok: false; reason: 'no_key' | 'not_configured' | 'network'; detail?: string };

/**
 * Baja lo pendiente del grupo, lo descifra y lo aplica.
 *
 * `skipped` cuenta los sobres que no se pudieron abrir. NO es un error: en un
 * topic conocido cualquiera puede inyectar basura (limitación del spike, ver
 * `supabase/001_mailbox.sql`), y un sobre de una época anterior tampoco abre.
 * Se saltean y se sigue — frenar la cola por un sobre ajeno sería un DoS
 * trivial contra el grupo.
 */
export async function drainGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  sinceSeq: number,
): Promise<DrainResult> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  const r = await fetchSince(topic, sinceSeq, deviceId);
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };

  let applied = 0;
  let skipped = 0;

  for (const envelope of r.envelopes) {
    const plain = openEnvelope(key, envelope.payload);
    if (plain === null) { skipped++; continue; }

    try {
      applyDelta(JSON.parse(plain) as SyncDelta, currentUserId);
      applied++;
    } catch {
      // Descifró pero el JSON no era un delta válido: se saltea igual.
      skipped++;
    }
  }

  return { ok: true, applied, skipped, cursor: r.cursor };
}
