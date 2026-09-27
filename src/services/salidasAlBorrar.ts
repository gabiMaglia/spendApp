import type { Group, Expense, Payment } from '@/src/types/models';
import { rosterDe } from '@/src/algorithms/roster';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';

/**
 * T-187 (decisión PO 2026-09-27): al borrar la cuenta, de qué grupos conviene
 * salir automáticamente — sólo aquellos donde el saldo de `accountId` es CERO
 * en TODAS las monedas: no debe, no le deben. Donde queda saldo abierto en
 * alguna moneda, el grupo lo sigue viendo como miembro («Cuenta borrada») con
 * la deuda visible — salir ahí le rompería las cuentas a los demás (regla #3
 * del proyecto: borrar ≠ liquidar, y ninguna de las dos es gratis).
 *
 * Pura, sin efectos: `deleteAccount.ts` es quien aplica `conBaja` con esta
 * lista, antes de anonimizar y publicar.
 */
export function gruposParaSalir(
  accountId: string,
  groups: readonly Group[],
  expenses: readonly Expense[],
  payments: readonly Payment[],
): string[] {
  return groups
    .filter(g => !g.isDeleted && rosterDe(g.miembros).includes(accountId))
    .filter(g => {
      const memberIds = rosterDe(g.miembros);
      const groupExpenses = expenses.filter(e => e.groupId === g.id);
      const groupPayments = pagosQueCuentan(payments, g);
      const balances = calculateBalancesByCurrency(groupExpenses, groupPayments, memberIds);
      const mio = balances.find(b => b.userId === accountId);
      return !mio || mio.balances.length === 0;
    })
    .map(g => g.id);
}
