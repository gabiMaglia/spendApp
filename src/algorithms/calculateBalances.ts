import type { CurrencyCode } from '@/src/constants/currencies';
import type { Balance, BalanceByCurrency, Expense, Payment } from '@/src/types/models';

// Redondea a 2 decimales evitando errores de punto flotante
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula el balance neto de cada miembro dentro de un grupo.
 * balance > 0 → le deben | balance < 0 → debe
 * Ignora gastos con isDeleted=true.
 * Asume moneda única (filtrá antes por currency si hay múltiples).
 */
export function calculateBalances(
  expenses: Expense[],
  memberIds: string[],
): Balance[] {
  const totals = new Map<string, number>(memberIds.map(id => [id, 0]));

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    const current = totals.get(expense.paidById) ?? 0;
    totals.set(expense.paidById, current + expense.amount);

    for (const split of expense.splits) {
      const splitCurrent = totals.get(split.userId) ?? 0;
      totals.set(split.userId, splitCurrent - split.amount);
    }
  }

  return Array.from(totals.entries()).map(([userId, amount]) => ({
    userId,
    amount: round2(amount),
  }));
}

/**
 * Calcula balances separados por moneda (para grupos con múltiples divisas).
 * Aplica también los pagos (Payment) que tienen su propia moneda.
 */
export function calculateBalancesByCurrency(
  expenses: Expense[],
  payments: Payment[],
  memberIds: string[],
): BalanceByCurrency[] {
  // mapa: userId → currency → net amount
  const totals = new Map<string, Map<CurrencyCode, number>>(
    memberIds.map(id => [id, new Map()]),
  );

  const addTo = (userId: string, currency: CurrencyCode, delta: number) => {
    const userMap = totals.get(userId);
    if (!userMap) return;
    userMap.set(currency, round2((userMap.get(currency) ?? 0) + delta));
  };

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    addTo(expense.paidById, expense.currency, expense.amount);
    for (const split of expense.splits) {
      addTo(split.userId, expense.currency, -split.amount);
    }
  }

  for (const payment of payments) {
    if (payment.isDeleted) continue;
    // fromUser pagó → reduce su deuda en targetCurrency o currency
    const effectiveCurrency = payment.targetCurrency ?? payment.currency;
    const effectiveAmount = payment.targetCurrency && payment.exchangeRate
      ? round2(payment.amount * payment.exchangeRate)
      : payment.amount;
    addTo(payment.fromUserId, effectiveCurrency, effectiveAmount);
    addTo(payment.toUserId,   effectiveCurrency, -effectiveAmount);
  }

  return Array.from(totals.entries()).map(([userId, currencyMap]) => ({
    userId,
    balances: Array.from(currencyMap.entries())
      .map(([currency, amount]) => ({ currency, amount }))
      .filter(b => Math.abs(b.amount) >= 0.01),
  }));
}
