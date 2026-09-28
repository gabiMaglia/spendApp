import { MANIFEST_VERSION, digestOfJson, type SliceManifest } from '@/src/sync/nucleo/manifest';

/**
 * T-206-A (D4): reemplaza a `buildManifest` (`nucleo/manifest.ts`), borrada
 * por no tener ningún consumidor de producción — `publicarPorCubos.ts:122`
 * arma el manifiesto INLINE (`{ version: MANIFEST_VERSION, entries }`), no
 * la llama. Sólo la usaban 5 archivos de test como fixture; este helper es
 * ese mismo cuerpo, movido a `test-utils` para que siga siendo un solo
 * lugar en vez de repetir el `for` + `digestOfJson` en cada archivo.
 */
export async function armarManifiesto(
  slices: { ckey: string; json: string }[],
): Promise<SliceManifest> {
  const entries = [];
  for (const slice of slices) {
    entries.push({ ckey: slice.ckey, digest: await digestOfJson(slice.json) });
  }
  return { version: MANIFEST_VERSION, entries };
}
