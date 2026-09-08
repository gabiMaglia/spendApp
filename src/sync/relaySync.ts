import { buildDelta, applyDelta, type SyncDelta } from './useSyncQR';
import { sealEnvelope, openEnvelope, deriveTopic } from './envelopeCrypto';
import { sendEnvelope, fetchSince, deleteMyEnvelopes, type DeleteResult } from './relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity } from '@/src/store/identityStore';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { observeAuthor } from './authorHealth';
import { refreshPendingAuthors } from './authorKeys';

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
  /**
   * `pending_drain` (T-089): el grupo todavía no drenó su buzón, así que
   * publicar mandaría un estado que puede resucitar lo que el grupo borró
   * mientras este teléfono estuvo afuera. **No es un fallo**: se resuelve solo
   * en cuanto el drenaje termine, y por eso no es bloqueante.
   */
  | { ok: false; reason: 'no_key' | 'too_large' | 'not_configured' | 'network' | 'pending_drain'; detail?: string };

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

  // La firma va POR FUERA del cifrado: autentica quién lo mandó sin exponer
  // nada de lo que va adentro (T-033).
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);

  // Compactable: este sobre lleva el estado COMPLETO del grupo, así que
  // reemplaza a los anteriores de este mismo dispositivo (T-032).
  const r = await sendEnvelope(topic, firmado, deviceId, true);
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
  return { ok: true, seq: r.seq };
}

/**
 * Saca del buzón los sobres que ESTE aparato publicó para el grupo (T-088).
 *
 * Deriva el topic igual que `publishToGroup`, así borra exactamente donde
 * publicó. Lo que NO alcanza, y hay que decirlo donde se muestre:
 *  - los sobres de OTROS miembros se quedan: cada uno borra los suyos;
 *  - los que publicó otra instalación de esta misma persona (reinstaló, o es
 *    su segundo teléfono) **no se pueden borrar desde acá**: sólo los levanta
 *    el TTL de 30 días. Es el límite de ADR-009 §4·A, y nadie lo resolvió sin
 *    identidad del lado del servidor (`ADR-009 §10.1`).
 *
 * Quién lo llama es T-074, y ese ticket tiene que purgar el buzón ANTES de
 * destruir la prenda: al revés, el secreto se pierde y los sobres quedan a
 * merced del TTL.
 */
export async function deleteMyGroupEnvelopes(
  groupId: string,
): Promise<DeleteResult | { ok: false; reason: 'no_key' }> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);
  return deleteMyEnvelopes(topic);
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
    // 1. Firma. Descarta lo ajeno ANTES de gastar una operación de cifrado.
    const firmado = verifyEnvelope(envelope.payload);
    if (firmado === null) { skipped++; continue; }

    // 2. Cifrado. Sin la clave del grupo no se lee nada, firme quien firme.
    const plain = openEnvelope(key, firmado.sealed);
    if (plain === null) { skipped++; continue; }

    let delta: SyncDelta;
    try {
      delta = JSON.parse(plain) as SyncDelta;
    } catch {
      // Descifró pero el JSON no era un delta válido: se saltea igual.
      skipped++;
      continue;
    }

    // 3. Autoría (ADR-004 fase B) — en modo AVISO. La firma prueba que quien
    // mandó tiene la privada de SU dispositivo; esto mira si ese dispositivo
    // está registrado bajo la cuenta que el delta dice ser. Va sin `await` a
    // propósito: es observación, y no puede meterse en el camino del sync ni
    // agregarle la latencia de una consulta por sobre.
    void observeAuthor(groupId, delta.fromUserId, firmado.senderKey);

    try {
      applyDelta(delta, currentUserId);
      applied++;
    } catch {
      skipped++;
    }
  }

  /**
   * Refresco de claves de autor FUERA DE BANDA (T-041 · S4).
   *
   * El merge no puede consultar el directorio: `applyDelta` es síncrono. Lo que
   * hace es encolar los autores que no pudo resolver, y la consulta sale acá,
   * una vez por vuelta, **sin `await`** — igual que `observeAuthor` arriba. Lo
   * que aprenda sirve para la próxima vuelta; una clave que todavía no está
   * produce `no_verificable`, que nunca es un rechazo.
   *
   * Con la cola vacía no hace absolutamente nada, que es el caso de hoy: hasta
   * que S6 verifique en el merge, nadie encola.
   */
  void refreshPendingAuthors();

  return { ok: true, applied, skipped, cursor: r.cursor };
}
