import { useMemo } from 'react';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { repartirDelMes, type BucketPersonal } from '@/src/algorithms/personalMonth';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';
import type { PersonalEntry } from '@/src/types/models';

/** Movimientos del mes activo, ordenados, y sus totales por balde (ingreso/gasto/grupo/carryover). */
export function usePersonalMonthTotals(activeMonth: string) {
  const entries = usePersonalStore(s => s.entries);
  const { fx, display: cur, loading: fxLoading } = useFx();

  const monthEntries = useMemo(
    () => entries.filter(e => !e.isDeleted && toMonthKey(e.date) === activeMonth),
    [entries, activeMonth],
  );

  // Memoizado (PO 2026-09-22, rendimiento en gama baja): antes se ordenaba
  // en el JSX, en CADA render de la pantalla (cambiar de tema, abrir el
  // BudgetSheet, etc.), aunque `monthEntries` no hubiera cambiado un pelo.
  const entriesOrdenadas = useMemo(
    () => [...monthEntries].sort((a, b) => b.date - a.date),
    [monthEntries],
  );

  const sumar = (pred: (e: PersonalEntry) => boolean) =>
    sumConverted(
      monthEntries.filter(pred).map(e => ({ currency: e.currency, minor: e.amount })),
      cur, fx,
    );

  const baldes   = repartirDelMes(monthEntries);
  const porBalde = (b: BucketPersonal) => sumar(e => baldes[b].includes(e));
  const income   = porBalde('income');
  const expense  = porBalde('expense');
  const group    = porBalde('group');
  const carryPos = porBalde('carryPos');
  const carryNeg = porBalde('carryNeg');

  const totalIncome       = income.totalMinor;
  const totalExpense      = expense.totalMinor;
  const totalGroup        = group.totalMinor;
  const positiveCarryover = carryPos.totalMinor;
  const negativeCarryover = carryNeg.totalMinor;
  const totalSpent        = totalExpense + totalGroup + negativeCarryover;

  const pendientes = [...expense.unconverted, ...group.unconverted];

  // T-109: cualquiera de los baldes que compone "Gastado"/"Disponible" puede
  // haber quedado afuera por falta de cache (no por tasa ausente) — mientras
  // el fetch siga en vuelo, los dos montos muestran `--` en vez de un total
  // parcial que después salta al real.
  const personalPending = fxLoading
    && (income.pending || expense.pending || group.pending || carryPos.pending || carryNeg.pending);

  return {
    cur, monthEntries, entriesOrdenadas,
    totalIncome, totalExpense, totalGroup, totalSpent,
    positiveCarryover, negativeCarryover,
    pendientes, personalPending,
  };
}
