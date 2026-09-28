import type { SyncDelta } from '@/src/sync/adaptadores/hushsplit/applyDelta';
import { openEnvelope, type GroupKey } from './envelopeCrypto';
import { verifyEnvelope } from './envelopeSign';
import { isManifest, looksLikeManifest, type SliceManifest } from './manifest';
import { registrarFalloDeAplicacion } from './drainFailures';
import type { Envelope } from '@/src/sync/adaptadores/supabase/relay';

export type AbrirResultado =
  | { tipo: 'manifiesto'; sender: string; manifest: SliceManifest; senderKey: string; seq: number }
  | { tipo: 'rebanada'; seq: number; ckey?: string; sender: string; delta: SyncDelta; senderKey: string; json: string }
  | { tipo: 'descartado' };

/**
 * Abre UN sobre: verifica firma, descifra, parsea y clasifica manifiesto vs
 * rebanada de datos (T-192, Task 4 — salió del loop de colección de
 * `drainGroup` para que `relay/drenar.ts` quede bajo 260 líneas). Nunca
 * aplica nada a los stores: sólo clasifica.
 */
export function abrirSobre(envelope: Envelope, key: GroupKey, topic: string): AbrirResultado {
  // 1. Firma. Descarta lo ajeno ANTES de gastar una operación de cifrado.
  const firmado = verifyEnvelope(envelope.payload);
  if (firmado === null) return { tipo: 'descartado' };

  // 2. Cifrado. Sin la clave del grupo no se lee nada, firme quien firme.
  const plain = openEnvelope(key, firmado.sealed);
  if (plain === null) return { tipo: 'descartado' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    return { tipo: 'descartado' }; // descifró pero el JSON no era válido
  }

  if (isManifest(parsed)) {
    return {
      tipo: 'manifiesto', sender: envelope.sender, manifest: parsed,
      senderKey: firmado.senderKey, seq: envelope.seq,
    };
  }

  // T-146, ronda 2 del verifier (D3): `looksLikeManifest` sólo mira
  // `version`/`entries`, `isManifest` ya validó también cada entrada — si
  // pasó lo primero y no lo segundo, es un manifiesto ROTO. Se descarta acá,
  // con rastro, y nunca se procesa como si fuera una rebanada de datos.
  if (looksLikeManifest(parsed)) {
    registrarFalloDeAplicacion(topic, envelope.seq, new Error('manifest_malformado'));
    return { tipo: 'descartado' };
  }

  // `senderKey` viaja por sobre, no por delta. `json` es el plano
  // post-descifrado, pre-parse: hace falta para recalcular el digest contra
  // el manifiesto.
  return {
    tipo: 'rebanada',
    seq: envelope.seq,
    ckey: envelope.ckey,
    sender: envelope.sender,
    delta: parsed as SyncDelta,
    senderKey: firmado.senderKey,
    json: plain,
  };
}
