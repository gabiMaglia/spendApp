/**
 * **Topes de tamaño de un registro** (T-150; SEC-07 + TEC-14).
 *
 * Nada acotaba lo que un miembro puede meter en un registro: una `note` de
 * megabytes o un `memberIds` de miles entraba al merge sin medirse, se
 * republicaba «entero» desde todos los teléfonos honestos y, si pasaba de
 * `MAX_SLICE_BYTES`, cada uno fallaba `too_large` al publicar — el grupo
 * dejaba de sincronizar para siempre por culpa de un solo registro.
 *
 * Los topes son generosos a propósito: una descripción de 200 caracteres, una
 * nota de 2.000, cien miembros. Nadie honesto los toca; un registro que los
 * pasa se descarta AL RECIBIR (`acotarDeltaAlGrupo`) y se excluye AL PUBLICAR
 * (`sliceEntities`), con rastro en el diagnóstico las dos veces. Y los inputs
 * de la app los aplican con `maxLength`, así que un usuario nuestro nunca
 * los cruza sin querer.
 *
 * Sin imports: lo usan módulos puros (acotar) y módulos con nativo (slices).
 */

export const MAX_TEXTO_CORTO = 200;
export const MAX_NOTA = 2_000;
export const MAX_MIEMBROS = 100;
/** Igual a `MAX_SLICE_BYTES` (`slices.ts`); repetido para no arrastrar `expo-crypto` acá. */
export const MAX_REGISTRO_BYTES = 262_144;

export function byteLengthUtf8(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const TEXTOS: readonly (readonly [campo: string, max: number])[] = [
  ['description', MAX_TEXTO_CORTO],
  ['name', MAX_TEXTO_CORTO],
  ['note', MAX_NOTA],
];

/**
 * `null` si el registro entra en todos los topes; si no, el nombre del tope
 * que viola (para el diagnóstico). Sólo mide lo que es del tipo esperado: un
 * campo ausente o de otro tipo no es un exceso — eso lo juzga el merge.
 */
export function excesoDe(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;

  for (const [campo, max] of TEXTOS) {
    const v = r[campo];
    if (typeof v === 'string' && v.length > max) return campo;
  }
  if (Array.isArray(r.memberIds) && r.memberIds.length > MAX_MIEMBROS) return 'memberIds';
  if (byteLengthUtf8(JSON.stringify(record)) > MAX_REGISTRO_BYTES) return 'bytes';
  return null;
}
