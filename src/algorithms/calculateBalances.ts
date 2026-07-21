import { minorFactor } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Balance, BalanceByCurrency, Expense, Payment } from '@/src/types/models';

/**
 * Escala fija de `Payment.exchangeRate` (ADR-002 §6). No es un monto en una
 * moneda — es un ratio — así que NO usa `minorFactor`. `exchangeRate`
 * almacenado = ratio_real * RATE_SCALE (entero).
 */
export const RATE_SCALE = 1_000_000;

/**
 * Convierte un monto (entero, menor unidad de `fromCurrency`) a la menor unidad
 * de `toCurrency` usando un `exchangeRate` almacenado ya escalado por RATE_SCALE.
 * Pasa por unidades reales (monto/minorFactor) porque el ratio es real↔real,
 * no menor-unidad↔menor-unidad (las dos monedas pueden tener distinta cantidad
 * de decimales, p.ej. ARS↔CLP).
 */
function convertMinorAmount(
  amountMinor: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  scaledExchangeRate: number,
): number {
  const realRate = scaledExchangeRate / RATE_SCALE;
  const sourceReal = amountMinor / minorFactor(fromCurrency);
  const targetReal = sourceReal * realRate;
  return Math.round(targetReal * minorFactor(toCurrency));
}

/**
 * Calcula el balance neto de cada miembro dentro de un grupo.
 * balance > 0 → le deben | balance < 0 → debe
 * Ignora gastos con isDeleted=true.
 * Asume moneda única (filtrá antes por currency si hay múltiples).
 * Todos los montos son ENTEROS en menor unidad (ADR-002) — aritmética entera
 * pura, sin epsilon.
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
    amount,
  }));
}

/**
 * Calcula balances separados por moneda (para grupos con múltiples divisas).
 * Aplica también los pagos (Payment) que tienen su propia moneda.
 * `Payment.exchangeRate` es un RATIO (no un monto) escalado con RATE_SCALE
 * (ADR-002 §6) — se aplica y se vuelve a redondear a entero de la moneda destino.
 */
export function calculateBalancesByCurrency(
  expenses: Expense[],
  payments: Payment[],
  memberIds: string[],
): BalanceByCurrency[] {
  // mapa: userId → currency → net amount (entero, menor unidad)
  const totals = new Map<string, Map<CurrencyCode, number>>(
    memberIds.map(id => [id, new Map()]),
  );

  const addTo = (userId: string, currency: CurrencyCode, delta: number) => {
    const userMap = totals.get(userId);
    if (!userMap) return;
    userMap.set(currency, (userMap.get(currency) ?? 0) + delta);
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
      ? convertMinorAmount(payment.amount, payment.currency, effectiveCurrency, payment.exchangeRate)
      : payment.amount;
    addTo(payment.fromUserId, effectiveCurrency, effectiveAmount);
    addTo(payment.toUserId,   effectiveCurrency, -effectiveAmount);
  }

  return Array.from(totals.entries()).map(([userId, currencyMap]) => ({
    userId,
    balances: Array.from(currencyMap.entries())
      .map(([currency, amount]) => ({ currency, amount }))
      .filter(b => b.amount !== 0),
  }));
}
