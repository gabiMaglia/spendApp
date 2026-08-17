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
 * Payload para el relay: el delta SIN las claves de grupo.
 *
 * Se construye quitando el campo explícitamente en vez de armar un objeto nuevo
 * campo por campo: así, si mañana se agrega una entidad al delta, viaja sola por
 * el relay en vez de olvidarse (que fue el bug de `personal`). Lo que hay que
 * recordar es lo que se EXCLUYE, que es una lista corta y crítica.
 */
export function buildRelayPayload(currentUserId: string): SyncDelta {
  const { groupKeys: _excluidas, ...sinClaves } = buildDelta(currentUserId);
  return sinClaves as SyncDelta;
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
  const sealed = sealEnvelope(key, JSON.stringify(buildRelayPayload(currentUserId)));

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
