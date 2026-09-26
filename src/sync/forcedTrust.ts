import { checkVote } from './trustCheck';
import { enDisputa } from './autoriaTrust';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **El predicado ÚNICO de «forced confiable»** (T-170 · D-1, plan
 * `engram/plans/T-169-170.md` §4 D-1: `esForcedConfiable = v =>
 * !enDisputa(e) && checkVote(e.id, v) === 'valida'`).
 *
 * Hasta esta ronda, `autoriaDisputada` se registraba en el merge (D-2) pero
 * NADIE lo consumía: `resolvePendingDeletions` sólo miraba `checkVote`, y
 * Mallory podía re-estampar el núcleo con su id, firmar un `forced` de
 * verdad —es su propia clave— y borrar al instante (T-170-verifier.md, D1).
 *
 * Este módulo es el ÚNICO lugar que decide si un override de creador
 * («forced») es confiable, y lo usan los dos caminos de producción que
 * deciden un borrado instantáneo por creador:
 *  - `src/services/resolveDeletions.ts` (`resolvePendingDeletions`, corre solo);
 *  - `app/expense/[id].tsx` (oculta la opción «Forzar» cuando no aplica).
 *
 * Un `forced` no confiable NO se descarta: sigue siendo un `delete` como
 * cualquier otro y abre su ronda de 72 h (T-143). Acá sólo se decide si es
 * INMEDIATO.
 */
export function esForcedConfiable(expense: Expense): (vote: DeletionVote) => boolean {
  return (vote) => !enDisputa(expense) && checkVote(expense.id, vote) === 'valida';
}
