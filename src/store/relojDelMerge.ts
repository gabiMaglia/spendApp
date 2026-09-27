/**
 * **El reloj del merge** (T-144, SEC-02; generaliza T-137/ADR-012).
 *
 * `updatedAt` lo escribe cualquiera —está fuera de la firma a propósito— y el
 * nivel «resto» del merge lo ordena por LWW. Sin tope, un `updatedAt: 9e15`
 * gana para siempre: `isDeleted`, `memberIds`, `name` quedan como los dejó el
 * atacante y ninguna edición honesta (`syncedNow()`) vuelve a superarlo.
 * T-137 cerró esto sólo para `users` (`mergeUsersLWW.ts`); acá vive el
 * criterio para que lo usen los cinco merges por niveles y las escrituras.
 *
 * Es un módulo puro sin `syncedClock` (abre almacenamiento nativo): `now` se
 * inyecta siempre.
 */

/**
 * Cuánto puede adelantarse una estampa (`updatedAt`, ...) antes de dejar de
 * ser creíble (T-059). Mudada acá desde el módulo de firmas del borrado con
 * acuerdo en T-186 (extraído, ver docs/CONSENSO-PENDIENTE.md): es general al
 * reloj del merge, no algo propio de ese modo.
 *
 * Entre dos relojes ya corregidos contra el relay (ADR-005) el desfase es de
 * milisegundos, así que este margen existe para el ruido de red y para el peer
 * que todavía no habló con el relay — no para tapar un reloj mal puesto.
 */
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;

/** ¿Este `updatedAt` no pudo haber pasado todavía, o ni siquiera es una fecha? */
export function envenenado(updatedAt: unknown, now: number): boolean {
  return typeof updatedAt !== 'number'
    || !Number.isFinite(updatedAt)
    || updatedAt > now + TOLERANCIA_RELOJ_MS;
}

/**
 * La estampa de una escritura PROPIA.
 *
 * Estrictamente mayor que la anterior cuando la anterior es plausible: dos
 * ediciones en el mismo milisegundo no empatan, y una edición honesta le gana a
 * un `updatedAt` ajeno que venía un poco adelantado (dentro de la tolerancia)
 * sin tener que esperar a que el reloj real lo alcance. Es lo mismo que
 * `siguienteRev` hace con `rev` (`signOnWrite.ts`).
 *
 * Cuando la anterior está envenenada NO se arrastra: `9e15 + 1` seguiría
 * envenenado y perdería contra todo el mundo. Se vuelve a `now`, que es lo que
 * deja que el autor sane su propio registro.
 */
export function siguienteUpdatedAt(previo: number | undefined, now: number): number {
  if (previo === undefined || envenenado(previo, now)) return now;
  return Math.max(now, previo + 1);
}
