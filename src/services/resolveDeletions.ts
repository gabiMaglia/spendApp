import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { resolveDeletionVotes } from '@/src/sync/SyncEngine';
import { esForcedConfiable } from '@/src/sync/forcedTrust';
import { syncedNow } from '@/src/utils/syncedClock';
import type { Expense } from '@/src/types/models';

/**
 * Aplica las solicitudes de borrado que ya cumplieron sus 72hs sin objeción, y
 * los overrides del creador **cuya firma cierra** (T-143).
 *
 * Esto FALTABA: `resolveDeletionVotes` existía, estaba testeado... y no lo
 * llamaba nadie. O sea que el plazo no vencía nunca y una solicitud quedaba
 * pendiente para siempre — la promesa de "si nadie objeta se borra" no se
 * cumplía jamás.
 *
 * Corre en cada arranque y después de cada sync, no con un temporizador: no
 * hay nada que ejecutar mientras la app está cerrada, y el vencimiento se
 * evalúa igual de bien al volver. Cada dispositivo llega a la misma conclusión
 * por su cuenta porque los votos viajan por el sync; el tombstone que resulte
 * se resuelve por LWW como cualquier otro.
 *
 * **Acá la firma AUTORIZA el override, no informa** (misma excepción a R1 que
 * `applyLeave.ts`): esto corre solo, sin nadie mirando, y borra datos de otros.
 * El costo es acotado — una verificación por gasto con `forced` vigente, con
 * caché de veredictos — y está fuera del merge (D9).
 *
 * **T-170 · D-1:** el predicado de confianza es `esForcedConfiable(e)`, el
 * ÚNICO que decide si un `forced` es inmediato — también corta cuando hay
 * autoría en disputa (`enDisputa`), aunque la firma cierre: la disputa
 * degrada a los DOS lados al camino seguro (ronda de 72 h), nunca sólo al
 * falso.
 */
export function resolvePendingDeletions(now: number = syncedNow()): number {
  const store = useExpenseStore.getState();
  const vencidas: Expense[] = store.expenses.filter(e =>
    !e.isDeleted &&
    (e.deletionVotes?.length ?? 0) > 0 &&
    resolveDeletionVotes(e, [], now, esForcedConfiable(e)),
  );

  for (const expense of vencidas) {
    store.updateExpense(expense.id, { isDeleted: true });
    // Los comentarios se tombstonean en cascada: si no, quedan huérfanos
    // apuntando a un gasto inexistente y viajando en cada sync.
    useCommentStore.getState().removeForExpense(expense.id);
  }

  return vencidas.length;
}
