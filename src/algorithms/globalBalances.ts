import { minorFactor } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment, Transaction } from '@/src/types/models';
import { calculateBalances, RATE_SCALE } from './calculateBalances';
import { simplifyDebts } from './simplifyDebts';

export interface PersonBalance {
  userId: string;
  byCurrency: { currency: CurrencyCode; amount: number }[];
}

/**
 * Calcula el balance global del usuario actual contra cada persona,
 * sumando todos los grupos y todas las monedas por separado.
 * amount > 0 → esa persona te debe | amount < 0 → le debés
 */
export function calculateGlobalBalances(
  groups: Group[],
  expenses: Expense[],
  payments: Payment[],
  currentUserId: string,
): PersonBalance[] {
  // mapa: otroUserId → currency → net amount
  const netMap = new Map<string, Map<CurrencyCode, number>>();

  const addTo = (userId: string, currency: CurrencyCode, delta: number) => {
    if (!netMap.has(userId)) netMap.set(userId, new Map());
    const m = netMap.get(userId)!;
    const prev = m.get(currency) ?? 0;
    m.set(currency, prev + delta);
  };

  for (const group of groups) {
    if (group.isDeleted) continue;

    // Agrupar gastos de este grupo por moneda
    const groupExpenses = expenses.filter(e => e.groupId === group.id && !e.isDeleted);
    const currencies = [...new Set(groupExpenses.map(e => e.currency))];

    for (const currency of currencies) {
      const currencyExpenses = groupExpenses.filter(e => e.currency === currency);
      const balances = calculateBalances(currencyExpenses, group.memberIds);
      const transactions = simplifyDebts(balances, currency);

      for (const tx of transactions) {
        if (tx.fromUserId === currentUserId) {
          addTo(tx.toUserId, tx.currency, -tx.amount);
        } else if (tx.toUserId === currentUserId) {
          addTo(tx.fromUserId, tx.currency, tx.amount);
        }
      }
    }

    // Aplicar pagos directos
    const groupPayments = payments.filter(p => p.groupId === group.id && !p.isDeleted);
    for (const payment of groupPayments) {
      const currency = payment.targetCurrency ?? payment.currency;
      const amount = payment.targetCurrency && payment.exchangeRate
        ? Math.round(
            (payment.amount / minorFactor(payment.currency))
              * (payment.exchangeRate / RATE_SCALE)
              * minorFactor(currency),
          )
        : payment.amount;

      if (payment.fromUserId === currentUserId) {
        addTo(payment.toUserId, currency, amount);
      } else if (payment.toUserId === currentUserId) {
        addTo(payment.fromUserId, currency, -amount);
      }
    }
  }

  return Array.from(netMap.entries())
    .map(([userId, currencyMap]) => ({
      userId,
      byCurrency: Array.from(currencyMap.entries())
        .map(([currency, amount]) => ({ currency, amount }))
        .filter(b => b.amount !== 0),
    }))
    .filter(p => p.byCurrency.length > 0);
}
