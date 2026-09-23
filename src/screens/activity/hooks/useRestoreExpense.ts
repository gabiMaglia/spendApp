import { useCallback } from 'react';
import { useExpenseStore } from '@/src/store/expenseStore';
import { emitirVoto } from '@/src/services/deletionVotes';
import { syncedNow } from '@/src/utils/syncedClock';
import type { User } from '@/src/types/models';

/**
 * Callback ESTABLE (PO 2026-09-22, rendimiento en gama baja — mismo patrón
 * que `GroupRow`/`ContactRow`/`EntryRow`): antes era una función inline
 * pasada directo por prop, así que envolver `EventRow` en `React.memo` no
 * servía de nada.
 */
export function useRestoreExpense(currentUser: User | null): (expenseId: string) => void {
  const updateExpense = useExpenseStore(st => st.updateExpense);

  return useCallback((expenseId: string) => {
    const gasto = useExpenseStore.getState().expenses.find(e => e.id === expenseId);
    if (!gasto || !currentUser) return;
    updateExpense(expenseId, {
      isDeleted: false,
      deletionVotes: emitirVoto(gasto, currentUser.id, 'restore', syncedNow()),
    });
  }, [currentUser, updateExpense]);
}
