import type { Expense, Payer } from '@/src/types/models';

/**
 * Quién puso plata en un gasto, y cuánto.
 *
 * ÚNICA fuente de verdad: nadie debe leer `expense.payers` ni `expense.paidById`
 * directo para calcular. La razón es que el sync es P2P sin servidor, así que
 * conviven gastos de dos formas:
 *   - viejos (o de un peer sin actualizar): sólo `paidById` ⇒ un pagador que
 *     puso el total;
 *   - nuevos: `payers` con el desglose.
 * Esta función normaliza las dos en la misma forma.
 */
export function expensePayers(expense: Expense): Payer[] {
  const list = expense.payers;
  if (!list || list.length === 0) {
    return [{ userId: expense.paidById, amount: expense.amount }];
  }
  return list;
}

/** ¿El gasto lo pagaron entre varios? */
export function hasMultiplePayers(expense: Expense): boolean {
  return expensePayers(expense).length > 1;
}

/**
 * El pagador principal: el que más puso. Ante empate gana el userId menor, para
 * que dos devices lleguen al mismo resultado sin coordinarse (misma regla
 * determinista que usa `buildSplits`).
 */
export function primaryPayerId(payers: Payer[]): string {
  if (payers.length === 0) return '';
  return payers.reduce((best, p) => {
    if (p.amount > best.amount) return p;
    if (p.amount === best.amount && p.userId < best.userId) return p;
    return best;
  }).userId;
}

export type PayersValidation =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'negative' | 'duplicate' | 'sum_mismatch'; difference?: number };

/**
 * Valida un desglose de pagadores contra el total del gasto.
 * La suma tiene que dar EXACTO: son enteros en menor unidad, no hay redondeo
 * que perdonar (ADR-002).
 */
export function validatePayers(payers: Payer[], totalAmount: number): PayersValidation {
  if (payers.length === 0) return { ok: false, reason: 'empty' };

  if (payers.some(p => !Number.isInteger(p.amount) || p.amount < 0)) {
    return { ok: false, reason: 'negative' };
  }

  const ids = new Set(payers.map(p => p.userId));
  if (ids.size !== payers.length) return { ok: false, reason: 'duplicate' };

  const sum = payers.reduce((t, p) => t + p.amount, 0);
  if (sum !== totalAmount) {
    return { ok: false, reason: 'sum_mismatch', difference: totalAmount - sum };
  }

  return { ok: true };
}

/**
 * Normaliza un desglose para guardar: descarta a los que pusieron 0 y calcula
 * el pagador principal. Devuelve `payers: undefined` cuando hay uno solo, para
 * no ensuciar el registro con un campo que no aporta (y que un peer viejo
 * ignoraría igual).
 */
export function normalizePayers(payers: Payer[]): { paidById: string; payers?: Payer[] } {
  const contributing = payers.filter(p => p.amount > 0);
  if (contributing.length <= 1) {
    return { paidById: contributing[0]?.userId ?? payers[0]?.userId ?? '' };
  }
  return { paidById: primaryPayerId(contributing), payers: contributing };
}
