import { useMemo, useState } from 'react';

import type { Expense } from '@/src/types/models';
import {
  calcularSplits, estadoInicialPorcentajes, type PercentSub, type SplitMode,
} from '@/src/screens/expense/repartoDeGasto';

/**
 * Estado del reparto de Nuevo gasto (T-223: salió de `app/expense/new.tsx`):
 * modo (iguales / porcentaje), sub-modo del porcentaje, los % tipeados y el
 * reparto calculado.
 */
export function useRepartoDeGasto(existente: Expense | undefined, amount: number, members: string[]) {
  const [inicial] = useState(() => estadoInicialPorcentajes(existente));
  const [splitMode,      setSplitMode]      = useState<SplitMode>(inicial.splitMode);
  const [percentSub,     setPercentSub]     = useState<PercentSub>(inicial.percentSub);
  const [samePercent,    setSamePercent]    = useState(inicial.samePercent);
  const [customPercents, setCustomPercents] = useState<string[]>(inicial.customPercents);

  const splits = useMemo(
    () => calcularSplits({ amount, members, splitMode, percentSub, samePercent, customPercents }),
    [amount, members, splitMode, percentSub, samePercent, customPercents],
  );

  const lastPercent  = splits[splits.length - 1]?.percent ?? 0;
  const percentError = splitMode === 'percentage' && amount > 0 && lastPercent < 0;

  /** Arranca todos con la parte entera de 100/N. */
  function repartirParejo() {
    if (members.length === 0) return;
    const equal = Math.floor(100 / members.length);
    setSamePercent(String(equal));
    setCustomPercents(members.slice(0, -1).map(() => String(equal)));
  }

  function cambiarModo(mode: SplitMode) {
    setSplitMode(mode);
    if (mode === 'percentage') repartirParejo();
  }

  function cambiarSubModo(sub: PercentSub) {
    setPercentSub(sub);
    repartirParejo();
  }

  /** Al cambiar de grupo: los % personalizados se vacían para los miembros nuevos. */
  function reiniciarParaMiembros(nuevos: string[]) {
    setCustomPercents(nuevos.slice(0, -1).map(() => ''));
  }

  return {
    splitMode, percentSub, samePercent, customPercents, splits, lastPercent, percentError,
    setSamePercent, setCustomPercents, cambiarModo, cambiarSubModo, reiniciarParaMiembros,
  };
}
