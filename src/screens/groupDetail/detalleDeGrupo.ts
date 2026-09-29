import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';

/** Lógica pura del detalle de grupo. T-223: salió de `app/groups/[id].tsx`. */

export type TimelineItem =
  | { type: 'expense'; data: Expense; ts: number }
  | { type: 'payment'; data: Payment; ts: number };

/** Gastos y pagos vivos del grupo, mezclados y con lo más nuevo arriba. */
export function armarTimeline(
  expenses: readonly Expense[], payments: readonly Payment[], groupId: string | undefined,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const e of expenses) {
    if (e.groupId === groupId && !e.isDeleted) items.push({ type: 'expense', data: e, ts: e.date });
  }
  for (const p of payments) {
    if (p.groupId === groupId && !p.isDeleted) items.push({ type: 'payment', data: p, ts: p.date });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

/** Lo que un miembro todavía debe o le deben en el grupo, sólo monedas con saldo. */
export function saldoPendienteDe(
  uid: string, expenses: readonly Expense[], payments: readonly Payment[], group: Group,
): { currency: CurrencyCode; amount: number }[] {
  const gastosDelGrupo = expenses.filter(e => e.groupId === group.id);
  const pagosDelGrupo = pagosQueCuentan(payments, group);
  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, group.memberIds);
  return (balances.find(b => b.userId === uid)?.balances ?? []).filter(b => b.amount !== 0);
}
