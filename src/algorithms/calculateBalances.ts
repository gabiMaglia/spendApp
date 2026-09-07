import { minorFactor, RATE_SCALE } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Balance, BalanceByCurrency, Expense, Payment } from '@/src/types/models';
import { expensePayers } from './payers';
import { idCanonico, rosterCanonico } from '@/src/store/identityAlias';

/** Re-exportada desde `constants/currencies`, donde vive; ver su docblock. */
export { RATE_SCALE };

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
 *
 * **Todo id entra por `idCanonico()`** (T-048 · D-3). Quien enlazó dos cuentas
 * tiene registros escritos con las dos identidades —y no se reescriben nunca
 * (D-6)—, así que sin esto la misma persona sería DOS nodos del grafo de
 * deudas: su saldo aparecería partido, y `simplifyDebts` podría emitirle una
 * transferencia de una mitad de sí misma a la otra.
 *
 * Va en la ENTRADA y no en las comparaciones, que es toda la diferencia:
 * colapsar dos claves de un `Map` es sumar sus valores, así que Σ de los
 * balances queda invariante y una transferencia entre dos alias de la misma
 * persona pasa a ser **aritméticamente imposible**, no improbable (ADR-008 §9).
 */
export function calculateBalances(
  expenses: Expense[],
  memberIds: string[],
): Balance[] {
  const totals = new Map<string, number>(rosterCanonico(memberIds).map(id => [id, 0]));

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    // Un gasto lo pueden haber puesto entre varios: se acredita a cada uno lo
    // que puso, no el total al "pagador principal".
    for (const payer of expensePayers(expense)) {
      const id = idCanonico(payer.userId);
      totals.set(id, (totals.get(id) ?? 0) + payer.amount);
    }

    for (const split of expense.splits) {
      const id = idCanonico(split.userId);
      totals.set(id, (totals.get(id) ?? 0) - split.amount);
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
    rosterCanonico(memberIds).map(id => [id, new Map()]),
  );

  // Mismo criterio que arriba: el id se traduce al ENTRAR (T-048 · D-3).
  const addTo = (rawUserId: string, currency: CurrencyCode, delta: number) => {
    const userMap = totals.get(idCanonico(rawUserId));
    if (!userMap) return;
    userMap.set(currency, (userMap.get(currency) ?? 0) + delta);
  };

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    for (const payer of expensePayers(expense)) {
      addTo(payer.userId, expense.currency, payer.amount);
    }
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
