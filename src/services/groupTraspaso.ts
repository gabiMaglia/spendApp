import { v4 as uuidv4 } from 'uuid';
import type { Group } from '@/src/types/models';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { buildCarryOverExpenses } from '@/src/algorithms/groupCarryOver';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';

/**
 * Traspasa un grupo a uno nuevo (T-058, PO 2026-09-20): no copia los gastos
 * viejos — cierra el balance del grupo viejo en uno o más `Expense` de
 * traspaso (uno por moneda, `buildCarryOverExpenses`) dentro del grupo
 * nuevo, y archiva el viejo de forma irrevocable (`reason: 'limit'`).
 *
 * `description` ya viene resuelta (con `t()`) desde la UI — este servicio no
 * depende de i18n, sigue el mismo criterio de pureza que el resto de
 * `src/algorithms`.
 */
export function traspasarGrupo(grupoViejo: Group, description: string, createdById: string): Group {
  const { expenses } = useExpenseStore.getState();
  const { payments } = usePaymentStore.getState();
  const gastosDelGrupo = expenses.filter(e => e.groupId === grupoViejo.id);
  const pagosDelGrupo = pagosQueCuentan(payments, grupoViejo);

  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, grupoViejo.memberIds);

  const ahora = syncedNow();
  const grupoNuevo: Group = {
    id: uuidv4(),
    name: `${grupoViejo.name} (2)`,
    memberIds: grupoViejo.memberIds,
    currency: grupoViejo.currency,
    createdAt: ahora,
    updatedAt: ahora,
    isDeleted: false,
    createdById,
    deletionVotes: [],
    deletionMode: grupoViejo.deletionMode,
  };

  const carryOvers = buildCarryOverExpenses(balances, grupoNuevo.id, description, createdById);

  useGroupStore.getState().addGroup(grupoNuevo);
  for (const gasto of carryOvers) {
    useExpenseStore.getState().addExpense(gasto);
  }

  useGroupStore.getState().updateGroup(grupoViejo.id, { supersededByGroupId: grupoNuevo.id });
  useArchiveStore.getState().setArchived(grupoViejo.id, true, 'limit');

  return grupoNuevo;
}
