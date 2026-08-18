import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { resolveDeletionVotes } from '@/src/sync/SyncEngine';
import type { Expense } from '@/src/types/models';

/**
 * Aplica las solicitudes de borrado que ya cumplieron sus 72hs sin objeción.
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
 */
export function resolvePendingDeletions(now: number = Date.now()): number {
  const store = useExpenseStore.getState();
  const vencidas: Expense[] = store.expenses.filter(e =>
    !e.isDeleted &&
    (e.deletionVotes?.length ?? 0) > 0 &&
    resolveDeletionVotes(e, [], now),
  );

  for (const expense of vencidas) {
    store.updateExpense(expense.id, { isDeleted: true });
    // Los comentarios se tombstonean en cascada: si no, quedan huérfanos
    // apuntando a un gasto inexistente y viajando en cada sync.
    useCommentStore.getState().removeForExpense(expense.id);
  }

  return vencidas.length;
}
