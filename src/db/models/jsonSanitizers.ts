// Sanitizadores para columnas `@json` de WatermelonDB (ADR-001).
// WatermelonDB llama al sanitizer con `JSON.parse(raw ?? 'null')` ya hecho;
// acá solo garantizamos un fallback seguro si la columna viniera vacía/corrupta
// (p. ej. registro creado antes de setear el campo, o dato migrado a mano).
export function sanitizeArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}
