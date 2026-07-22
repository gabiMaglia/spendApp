// Sanitizers para columnas `@json` de WatermelonDB (splits, deletion_votes,
// member_ids). El decorator @json parsea el string almacenado y pasa el valor
// crudo por este sanitizer antes de exponerlo; si el dato está corrupto o no es
// un array, devolvemos `[]` para no romper la app (nunca `undefined`/`null`).
export function sanitizeArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}
