import { toMinorUnits } from '@/src/constants/currencies';
import { RATE_SCALE } from '@/src/constants/currencies';
import type { Expense, Payment, PersonalBudget, PersonalEntry } from '@/src/types/models';

/**
 * Conversión ONE-SHOT de montos float (unidad real) a enteros en menor
 * unidad (ADR-002 §6). Funciones PURAS — sin acceso a storage — para que
 * cada store las invoque desde su propio `hydrate()` bajo el guard
 * `money_int_v1_done`, y para que sean testeables sin mockear MMKV.
 *
 * Idempotencia: estas funciones NO verifican el guard — es responsabilidad
 * del caller (cada store) invocarlas una única vez, guardado por
 * `money_int_v1_done`. Llamarlas dos veces sobre el mismo dato multiplicaría
 * el monto otra vez por el factor.
 */

export function migrateExpenseAmounts(expenses: Expense[]): Expense[] {
  return expenses.map(e => ({
    ...e,
    amount: toMinorUnits(e.amount, e.currency),
    splits: e.splits.map(s => ({ ...s, amount: toMinorUnits(s.amount, e.currency) })),
  }));
}

export function migratePaymentAmounts(payments: Payment[]): Payment[] {
  return payments.map(p => ({
    ...p,
    amount: toMinorUnits(p.amount, p.currency),
    // `exchangeRate` es un RATIO, no un monto — se escala con RATE_SCALE,
    // NUNCA con minorFactor (ADR-002 §6).
    exchangeRate: p.exchangeRate !== undefined
      ? Math.round(p.exchangeRate * RATE_SCALE)
      : p.exchangeRate,
  }));
}

export function migratePersonalEntryAmounts(entries: PersonalEntry[]): PersonalEntry[] {
  return entries.map(e => ({ ...e, amount: toMinorUnits(e.amount, e.currency) }));
}

export function migratePersonalBudgetAmount(budget: PersonalBudget): PersonalBudget {
  return { ...budget, monthlyAmount: toMinorUnits(budget.monthlyAmount, budget.currency) };
}
