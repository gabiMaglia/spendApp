import i18n from '@/src/i18n';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { idCanonico } from '@/src/store/identityAlias';
import type { Balance, Expense, Group, Payment } from '@/src/types/models';

/**
 * Lógica pura de «Saldar deuda». T-223: salió de `app/settle/new.tsx` tal
 * cual; los montos son enteros en menor unidad (ADR-002).
 */

export function formatDate(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return i18n.t('common.today');
  if (dMid.getTime() === yesterday.getTime()) return i18n.t('common.yesterday');
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
}

/** Balances reales del grupo en esta moneda: gastos MENOS lo ya pagado. */
export function balancesEnMoneda(
  group: Group | undefined,
  allExpenses: Expense[],
  allPayments: Payment[],
  currency: CurrencyCode,
): Balance[] {
  if (!group) return [];

  const porMoneda = calculateBalancesByCurrency(
    allExpenses.filter(e => e.groupId === group.id && !e.isDeleted),
    pagosQueCuentan(allPayments, group).filter(p => !p.isDeleted),
    group.memberIds,
  );
  return porMoneda.map(u => ({
    userId: u.userId,
    amount: u.balances.find(b => b.currency === currency)?.amount ?? 0,
  }));
}

type Traductor = (key: string, opts: { amount: string }) => string;

/** Lo que hay que mostrarle al lado del nombre al elegir a alguien. */
export function hintDe(
  balances: Balance[], uid: string, currency: CurrencyCode, t: Traductor,
): string | undefined {
  const saldo = balances.find(b => b.userId === idCanonico(uid))?.amount ?? 0;
  if (saldo === 0) return undefined;
  return saldo > 0
    ? t('settle.hint_owed', { amount: formatMoney(saldo, currency) })
    : t('settle.hint_owes', { amount: formatMoney(Math.abs(saldo), currency) });
}

export function puedeGuardarSaldo({
  amount, exceedsMax, fromId, toId, groupId, grupoArchivado,
}: {
  amount: number;
  exceedsMax: boolean;
  fromId: string;
  toId: string;
  groupId: string;
  grupoArchivado: boolean;
}): boolean {
  return amount > 0 && !exceedsMax && fromId.length > 0 && toId.length > 0 && fromId !== toId && groupId.length > 0 && !grupoArchivado;
}
