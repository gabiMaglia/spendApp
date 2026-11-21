/** Tope de filas de Personal: más que eso se lee en la pantalla «Ver todos» (T-277). */
export const MAX_MOVIMIENTOS_PERSONAL = 6;

/** Recorta a los primeros `max` (la lista ya viene ordenada) y dice si quedó algo afuera. */
export function limitarMovimientos<T>(entries: T[], max: number = MAX_MOVIMIENTOS_PERSONAL) {
  return { visibles: entries.slice(0, max), total: entries.length, hayMas: entries.length > max };
}
