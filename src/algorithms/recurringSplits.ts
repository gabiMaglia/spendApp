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
  const n = memberIds.length;
  const firstPercents = percents.slice(0, Math.max(n - 1, 0));
  const firstAmounts = firstPercents.map(pct => Math.round(amount * pct / 100));
  const splits = buildSplits(amount, memberIds, 'custom', firstAmounts);
  if (n < 2) return splits;

  // Con el último en 0% (o si el redondeo de los demás se pasa del total) el
  // «resto» daba una parte negativa o un centavo a quien no le toca nada. El
  // desvío cae en el miembro con mayor % > 0 (el primero si empatan).
  const lastPercent = 100 - firstPercents.reduce((a, b) => a + b, 0);
  const last = splits[n - 1];
  if (lastPercent > 1e-9 && last.amount >= 0) return splits;

  let receptor = -1;
  firstPercents.forEach((pct, i) => { if (pct > 0 && (receptor < 0 || pct > firstPercents[receptor])) receptor = i; });
  if (receptor < 0) return splits;
  return splits.map((s, i) =>
    i === n - 1 ? { ...s, amount: 0 } : i === receptor ? { ...s, amount: s.amount + last.amount } : s,
  );
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
