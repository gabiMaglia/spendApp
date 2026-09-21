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

export function isManifest(value: unknown): value is SliceManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === MANIFEST_VERSION && Array.isArray(v.entries);
}
