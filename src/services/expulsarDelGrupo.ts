import { esYo } from '@/src/store/identityAlias';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { planAbsorption } from '@/src/algorithms/absorbBalance';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { conBaja } from '@/src/algorithms/roster';
import { syncedNow } from '@/src/utils/syncedClock';

export type ResultadoExpulsion = 'ok' | 'no_creador' | 'no_miembro';

/**
 * Expulsar a alguien del grupo (T-182 Task 2). Sólo el creador puede
 * hacerlo, y es unilateral: a diferencia de salir con saldo
 * (`applyLeave.ts`), no hay ronda de aprobación — el creador fuerza el cierre
 * y absorbe él mismo lo que quede.
 *
 * El saldo del expulsado se cierra igual que una salida con absorción: pagos
 * derivados (`src/algorithms/absorbBalance.ts`), sin firma (`derived: true`,
 * T-041 · S6) porque el device que resuelve no es el autor de ninguna de las
 * dos puntas. El id sigue la misma forma que `leave:...`
 * (`applyLeave.ts:idDelPago`) — `expel:<groupId>:<userId>:<at>:<i>` — y por
 * eso `settlementStatus.esPagoDeCierreForzado` reconoce a los dos por igual:
 * ninguno pide acuse, aunque el grupo sea `consensus` (T-182, ver el
 * comentario de esa función para el motivo).
 *
 * Sin modelo de miembro malicioso (decisión del PO 2026-09-27, T-182
 * simplificado): no hay firmas que verificar acá, sólo el chequeo de que
 * quien llama es la sesión activa del creador (`esYo`).
 */
export function expulsar(
  groupId: string, userId: string, now: number = syncedNow(),
): ResultadoExpulsion {
  const groupStore = useGroupStore.getState();
  const group = groupStore.getById(groupId);
  if (!group || group.isDeleted) return 'no_miembro';
  if (!esYo(group.createdById)) return 'no_creador';
  if (!group.memberIds.includes(userId)) return 'no_miembro';

  const { expenses } = useExpenseStore.getState();
  const { payments } = usePaymentStore.getState();
  const gastosDelGrupo = expenses.filter(e => e.groupId === groupId);
  const pagosDelGrupo = pagosQueCuentan(payments, group);

  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, group.memberIds);
  const balanceExpulsado = balances.find(b => b.userId === userId)?.balances ?? [];

  // Un solo absorbente: el creador. `mode: 'equal'` no importa con un único
  // id — es el modo por defecto de `planAbsorption`.
  const plan = planAbsorption(userId, balanceExpulsado, [group.createdById]);

  plan.forEach((p, i) => {
    usePaymentStore.getState().addPayment({
      id:          `expel:${groupId}:${userId}:${now}:${i}`,
      groupId,
      fromUserId:  p.fromUserId,
      toUserId:    p.toUserId,
      amount:      p.amount,
      currency:    p.currency,
      date:        now,
      createdAt:   now,
      // El `createdById` es el del EXPULSADO, como en `applyLeave.ts`: es la
      // convención que `esPagoDeCierreForzado` no necesita — se reconoce por
      // el prefijo del id — pero mantenerla es lo que deja auditar a quién
      // pertenece el pago con sólo mirar el registro, igual que `leave:`.
      createdById: userId,
      updatedAt:   now,
      isDeleted:   false,
    }, { derived: true });
  });

  groupStore.updateGroup(groupId, { miembros: conBaja(group, userId, now).miembros });

  return 'ok';
}
