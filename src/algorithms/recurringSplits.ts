import { buildSplits } from './buildSplits';
import type { RecurringExpense, Split } from '@/src/types/models';

/**
 * Reparto de un gasto a partir de lo que guarda la plantilla recurrente (T-251).
 *
 * El modo «porcentaje» de la pantalla NO es `buildSplits('percentage')`: el
 * usuario tipea el % de todos menos el último, los montos de esos se redondean
 * desde su % y el último recibe el resto. Para que la cuota materializada sea
 * EXACTAMENTE la que vio el usuario, la pantalla y el materializador comparten
 * `splitsPorPorcentajes`.
 */

/**
 * Montos redondeados desde el % de cada uno salvo el último, que cierra el
 * total. Acepta los % de todos o de todos menos el último (éste se ignora).
 */
export function splitsPorPorcentajes(amount: number, memberIds: string[], percents: number[]): Split[] {
  const firstAmounts = percents.slice(0, Math.max(memberIds.length - 1, 0)).map(pct => Math.round(amount * pct / 100));
  return buildSplits(amount, memberIds, 'custom', firstAmounts);
}

/** Los % que la plantilla guarda en `splitValues`: uno por miembro, en orden. */
export function porcentajesDelReparto(splits: Array<{ percent: number }>): number[] {
  return splits.map(s => s.percent);
}

export type SplitsDePlantilla = {
  splits: Split[];
  /** true = la plantilla no traía lo necesario y se repartió en partes iguales. */
  degradado: boolean;
};

function valoresValidos(values: number[] | undefined, n: number): values is number[] {
  return Array.isArray(values) && values.length === n && values.every(Number.isFinite);
}

/**
 * Nunca tira. Una plantilla de antes de T-251 (modo no igual, sin valores) o
 * corrupta se reparte en partes iguales entre los mismos miembros: es el daño
 * menor frente a dejar de generar el gasto o cortar el arranque de la app.
 */
export function splitsDePlantilla(t: RecurringExpense): SplitsDePlantilla {
  const { amount, memberIds, splitMode, splitValues } = t;
  const iguales = (degradado: boolean): SplitsDePlantilla =>
    ({ splits: buildSplits(amount, memberIds, 'equal'), degradado });

  if (splitMode === 'equal') return iguales(false);

  try {
    if (splitMode === 'percentage') {
      if (!valoresValidos(splitValues, memberIds.length)) return iguales(true);
      const splits = splitsPorPorcentajes(amount, memberIds, splitValues);
      return splits.some(s => s.amount < 0) ? iguales(true) : { splits, degradado: false };
    }
    return { splits: buildSplits(amount, memberIds, splitMode, splitValues), degradado: false };
  } catch {
    return iguales(true);
  }
}
