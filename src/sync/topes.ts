/**
 * **Topes de tamaño de un registro** (T-150; SEC-07 + TEC-14).
 *
 * Nada acotaba lo que un miembro puede meter en un registro: una `note` de
 * megabytes o un `memberIds` de miles entraba al merge sin medirse, se
 * republicaba «entero» desde todos los teléfonos honestos y, si pasaba de
 * `MAX_SLICE_BYTES`, cada uno fallaba `too_large` al publicar — el grupo
 * dejaba de sincronizar para siempre por culpa de un solo registro.
 *
 * **Ronda 2 — enmienda del PO 2026-09-26** (tras QA+verifier RECHAZADO,
 * `engram/qa/T-150.md` D1, `engram/qa/T-150-verifier.md` D1-D4): «sólo bytes
 * al recibir». `excesoDe` es EL ÚNICO predicado, usado sin diferencias por
 * `acotarDeltaAlGrupo` (recibir) y por `sliceEntities` (publicar) — antes
 * cada puerta medía distinto (recibir medía texto + bytes, publicar sólo
 * bytes), y eso hacía que un registro honesto se publicara pero todos los
 * peers lo descartaran al recibir: divergencia permanente (D1 del
 * verificador). Ahora mide sólo dos cosas, las que de verdad pueden romper el
 * transporte:
 *
 *  - `memberIds.length > MAX_MIEMBROS` — de un registro VIVO. Los tombstones
 *    (`isDeleted: true`) quedan exentos: un borrado nunca se pierde por
 *    contenido heredado de antes de este tope (D2 del verificador —
 *    CLAUDE.md regla 1, tombstones obligatorios).
 *  - `bytes > MAX_REGISTRO_BYTES` — de CUALQUIER registro, tombstone
 *    incluido: es lo único que en verdad puede tumbar la publicación
 *    (`sendEnvelope` rechaza sobres por encima de `MAX_PAYLOAD_BYTES`). Un
 *    tombstone que por sí solo pesa más de 256 KB queda como residual
 *    documentado (no implementado en esta ronda): recortar su contenido
 *    pesado al generarlo tocaría `description`/`note`/`splits`, que son
 *    campos `core` de la firma (`recordCore.ts`) — cualquier recorte ahí
 *    invalida la firma existente. Ver handoff de retorno T-150 ronda 2.
 *
 * Los topes de caracteres (`MAX_TEXTO_CORTO`, `MAX_NOTA`) YA NO forman parte
 * de este predicado — quedaron sólo en los inputs de la app (`maxLength`) y
 * en los textos que la app misma genera (`truncar`, más abajo). Un dato
 * legado de antes de T-150 (sin `maxLength`) ya no se pierde por eso.
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

/**
 * `null` si el registro entra en todos los topes; si no, el nombre del tope
 * que viola (para el diagnóstico). Sólo mide lo que es del tipo esperado: un
 * campo ausente o de otro tipo no es un exceso — eso lo juzga el merge.
 */
export function excesoDe(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;

  if (r.isDeleted !== true && Array.isArray(r.memberIds) && r.memberIds.length > MAX_MIEMBROS) {
    return 'memberIds';
  }
  if (byteLengthUtf8(JSON.stringify(record)) > MAX_REGISTRO_BYTES) return 'bytes';
  return null;
}

/**
 * Corta un texto GENERADO POR LA APP (no un input libre del usuario, que ya
 * tiene `maxLength`) al tope de caracteres correspondiente. T-150 ronda 2
 * (D3, verifier): el nombre de un grupo traspasado y la descripción del
 * gasto de arrastre podían crecer sin límite (sufijos " (N)" repetidos,
 * nombres largos interpolados) — ya no se descartan al recibir/publicar
 * (ver arriba), pero la app sigue acotando lo que ella misma produce.
 */
export function truncar(s: string, max: number): string {
  if (s.length <= max) return s;
  const cortado = s.slice(0, max);
  // T-172 (ítem 5): un corte por unidad UTF-16 puede caer en medio de un
  // emoji fuera del BMP (surrogate alto + bajo) y dejar el alto suelto al
  // final — no es texto UTF-16 válido. Si eso pasó, se descarta ese último
  // code unit entero (el emoji completo queda afuera, nunca partido).
  const ultimo = cortado.charCodeAt(cortado.length - 1);
  return ultimo >= 0xD800 && ultimo <= 0xDBFF ? cortado.slice(0, -1) : cortado;
}

/** ¿Hay lugar para un miembro más sin superar `MAX_MIEMBROS`? (T-150 ronda 2, D4). */
export function admiteUnMiembroMas(memberIdsActuales: readonly string[]): boolean {
  return memberIdsActuales.length < MAX_MIEMBROS;
}
