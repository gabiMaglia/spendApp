import type { SimpleStorage } from '@/src/utils/createStorage';
import { recordError } from '@/src/services/errorLog';
import { readScoped, respaldarCrudo } from '@/src/store/userScope';

/**
 * Lee un blob scopeado que debe ser un arreglo de objetos (T-264).
 *
 * Antes un JSON roto se tragaba en silencio y el store arrancaba con `[]`; la
 * primera escritura siguiente pisaba el blob y los datos se perdían sin rastro.
 * Ahora, ante cualquier daño, se guarda el crudo aparte ANTES de que algo
 * escriba, se anota el error (sin contenido: sólo la clave) y se rescata lo que
 * sí es un objeto. Nunca lanza.
 */
export function leerBlobArreglo<T>(
  storage: SimpleStorage,
  base: string,
  raw: string | undefined = readScoped(storage, base),
): T[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) throw new Error('no es un arreglo');
    const sanos = v.filter(x => typeof x === 'object' && x !== null && !Array.isArray(x));
    if (sanos.length !== v.length) reportar(storage, base, raw, `${v.length - sanos.length} registro(s) descartado(s)`);
    return sanos as T[];
  } catch (e) {
    reportar(storage, base, raw, e instanceof Error ? e.message : 'JSON ilegible');
    return [];
  }
}

function reportar(storage: SimpleStorage, base: string, raw: string, detalle: string): void {
  try { respaldarCrudo(storage, base, raw); } catch { /* sin espacio: igual se anota */ }
  recordError({ message: `blob corrupto en "${base}": ${detalle}`, fatal: false });
}
