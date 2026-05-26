import type { Split, SplitMode } from '@/src/types/models';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Construye el array de splits para un gasto.
 *
 * Modos:
 *   'equal'      — Divide el total por igual. El último miembro absorbe el centavo de redondeo.
 *   'percentage' — values[i] = % de cada miembro (deben sumar 100).
 *   'custom'     — values[i] = monto de cada miembro EXCEPTO el último,
 *                  que recibe automáticamente el resto (total − suma de los demás).
 *
 * @param totalAmount  Monto total del gasto
 * @param memberIds    IDs de los miembros en el split, en orden
 * @param mode         Modo de división
 * @param values       Para 'percentage' y 'custom': array de longitud memberIds.length − 1
 *                     (el último miembro se calcula solo en 'custom') o memberIds.length
 *                     (para 'percentage' todos deben estar).
 */
export function buildSplits(
  totalAmount: number,
  memberIds: string[],
  mode: SplitMode,
  values?: number[],
): Split[] {
  if (memberIds.length === 0) return [];

  switch (mode) {
    case 'equal': {
      const share = round2(totalAmount / memberIds.length);
      return memberIds.map((userId, i) => ({
        userId,
        amount: i < memberIds.length - 1
          ? share
          : round2(totalAmount - share * (memberIds.length - 1)),
        isPaid: false,
      }));
    }

    case 'percentage': {
      if (!values || values.length !== memberIds.length) {
        throw new Error('buildSplits: percentage requiere values con un % por miembro');
      }
      return memberIds.map((userId, i) => ({
        userId,
        amount: round2(totalAmount * values[i]! / 100),
        isPaid: false,
      }));
    }

    case 'custom': {
      // values contiene los montos de todos los miembros excepto el último.
      // El último recibe el resto.
      const othersCount = memberIds.length - 1;
      if (!values || values.length !== othersCount) {
        throw new Error(
          `buildSplits: custom requiere values con ${othersCount} montos (todos menos el último)`,
        );
      }
      const sumOthers = values.reduce((a, b) => a + b, 0);
      const lastAmount = round2(totalAmount - sumOthers);
      return memberIds.map((userId, i) => ({
        userId,
        amount: i < othersCount ? round2(values[i]!) : lastAmount,
        isPaid: false,
      }));
    }
  }
}

/**
 * Para 'custom': calcula el monto restante para el último miembro en tiempo real.
 * Útil para mostrarlo mientras el usuario escribe.
 */
export function calculateRemainder(totalAmount: number, enteredAmounts: number[]): number {
  const sum = enteredAmounts.reduce((a, b) => a + b, 0);
  return round2(totalAmount - sum);
}

/**
 * Valida que los porcentajes de un split 'percentage' sumen 100 (con tolerancia).
 */
export function validatePercentages(percentages: number[]): boolean {
  const sum = percentages.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.1;
}
