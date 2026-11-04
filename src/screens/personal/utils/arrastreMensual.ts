import type { CurrencyCode } from '@/src/constants/currencies';
import { convertMinor, type FxCache } from '@/src/services/fx';
import { toMonthKey } from '@/src/store/personalStore';
import type { PersonalBudget, PersonalEntry } from '@/src/types/models';

export type ResultadoArrastre =
  | { status: 'ok'; remaining: number }
  | { status: 'pendiente' };

/** Monedas con movimientos vivos en el mes (para saber qué cotizaciones hacen falta). */
export function monedasDelMes(entries: readonly PersonalEntry[], month: string): CurrencyCode[] {
  const set = new Set<CurrencyCode>();
  for (const e of entries) if (!e.isDeleted && toMonthKey(e.date) === month) set.add(e.currency);
  return Array.from(set);
}

function signo(e: PersonalEntry): number {
  switch (e.kind) {
    case 'income':
    case 'payment_in':   return 1;
    case 'carryover':    return e.isPositiveCarryover ? 1 : -1;
    default:             return -1; // expense, payment_out, group_replicated
  }
}

/**
 * Sobrante (o excedido) del mes que se cierra, en unidades menores de la
 * moneda del presupuesto.
 *
 * EXCEPCIÓN del PO (2026-11-04) a la regla 7 de CLAUDE.md: acá la conversión SÍ
 * entra a un registro (el carryover), con la cotización vigente al cierre.
 * Se netea por moneda en enteros exactos y se convierte cada neto una sola vez
 * (mismo `convertMinor` que `sumConverted`), nunca por entrada.
 *
 * Si falta la cotización de alguna moneda presente devuelve `pendiente`: un
 * cierre con un número incompleto sería peor que cerrar más tarde.
 */
export function calcularArrastre(p: {
  entries: readonly PersonalEntry[];
  month: string;
  budget: PersonalBudget;
  owedToMe: number;
  fx: FxCache | null;
}): ResultadoArrastre {
  const cy = p.budget.currency;
  const netos = new Map<CurrencyCode, number>();
  for (const e of p.entries) {
    if (e.isDeleted || toMonthKey(e.date) !== p.month) continue;
    netos.set(e.currency, (netos.get(e.currency) ?? 0) + signo(e) * e.amount);
  }

  let remaining = p.budget.monthlyAmount + (p.budget.includeOwedToMe ? p.owedToMe : 0);
  for (const [currency, neto] of netos) {
    const convertido = convertMinor(neto, currency, cy, p.fx);
    if (convertido === null) return { status: 'pendiente' };
    remaining += convertido;
  }
  return { status: 'ok', remaining };
}
