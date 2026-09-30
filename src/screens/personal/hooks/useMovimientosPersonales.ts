import { useMemo } from 'react';
import { movimientosDerivados } from '@/src/algorithms/movimientosDerivados';
import { unirMovimientos } from '@/src/algorithms/unirMovimientos';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import type { PersonalEntry } from '@/src/types/models';

/** Todos los movimientos de Personal: guardados + derivados de gastos y pagos (T-229). */
export function useMovimientosPersonales(): PersonalEntry[] {
  const guardados = usePersonalStore(s => s.entries);
  const expenses  = useExpenseStore(s => s.expenses);
  const payments  = usePaymentStore(s => s.payments);
  const groups    = useGroupStore(s => s.groups);
  const me        = useAuthStore(s => s.currentUser?.id ?? '');
  return useMemo(
    () => unirMovimientos(guardados, me ? movimientosDerivados({ expenses, payments, groups, me }) : []),
    [guardados, expenses, payments, groups, me],
  );
}
