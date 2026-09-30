import { esYo } from '@/src/store/identityAlias';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { deudasDelGrupo } from '@/src/algorithms/deudasDelGrupo';
import { tieneDeudaViva } from '@/src/algorithms/deudaViva';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { conBaja } from '@/src/algorithms/roster';
import { syncedNow } from '@/src/utils/syncedClock';

export type ResultadoExpulsion = 'ok' | 'no_creador' | 'no_miembro' | 'con_deuda';

/**
 * Expulsar a alguien del grupo (T-182). Sólo el creador, y nunca a sí mismo.
 *
 * T-228 (PO 2026-09-29): nadie sale con deuda viva. Si el expulsado debe o le
 * deben algo, en cualquier moneda y a cualquiera, no se expulsa: primero se
 * salda. Ya no hay absorción ni pagos automáticos.
 */
export function expulsar(
  groupId: string, userId: string, now: number = syncedNow(),
): ResultadoExpulsion {
  const groupStore = useGroupStore.getState();
  const group = groupStore.getById(groupId);
  if (!group || group.isDeleted) return 'no_miembro';
  if (!esYo(group.createdById)) return 'no_creador';
  if (!group.memberIds.includes(userId)) return 'no_miembro';

  const deudas = deudasDelGrupo(
    useExpenseStore.getState().expenses.filter(e => e.groupId === groupId),
    pagosQueCuentan(usePaymentStore.getState().payments, group),
    group.memberIds,
  );
  if (tieneDeudaViva(deudas, userId)) return 'con_deuda';

  groupStore.updateGroup(groupId, { miembros: conBaja(group, userId, now).miembros });
  return 'ok';
}
