import * as Crypto from 'expo-crypto';

export const MANIFEST_VERSION = 2;

export type SliceManifestEntry = { ckey: string; digest: string };
export type SliceManifest = { version: 2; entries: SliceManifestEntry[] };

export async function digestOfJson(json: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, json);
}

export async function buildManifest(
  slices: { ckey: string; json: string }[],
): Promise<SliceManifest> {
  const entries: SliceManifestEntry[] = [];
  for (const slice of slices) {
    entries.push({ ckey: slice.ckey, digest: await digestOfJson(slice.json) });
  }
  return { version: MANIFEST_VERSION, entries };
}

function isManifestEntry(value: unknown): value is SliceManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ckey === 'string' && typeof v.digest === 'string';
}

/**
 * T-146, ronda 2 del verifier (defecto D3): antes sólo pedía `version === 2`
 * y `entries` array, sin mirar los ELEMENTOS. Un sobre firmado y cifrado con
 * la clave del grupo cuyo texto plano fuera `{"version":2,"entries":[null]}`
 * pasaba como manifiesto válido, y `entry.ckey` tiraba un TypeError DESPUÉS
 * del loop de rebanadas en `relaySync.ts` — fuera de cualquier `try`. Ahora
 * cada entrada se valida: objeto con `ckey` y `digest` de tipo `string`.
 */
export function isManifest(value: unknown): value is SliceManifest {
  if (!looksLikeManifest(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.entries as unknown[]).every(isManifestEntry);
}

/**
 * Reconoce la INTENCIÓN de ser un manifiesto (`version 2` + `entries` array)
 * aunque las entradas sean inválidas. Sirve para distinguir, en `relaySync.ts`,
 * "esto no es un manifiesto" (se procesa como rebanada de datos) de "esto
 * QUISO ser un manifiesto pero está roto" (se descarta con rastro y nunca se
 * trata como rebanada ni como manifiesto).
 */
export function looksLikeManifest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === MANIFEST_VERSION && Array.isArray(v.entries);
}
