import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePersonalStore, toMonthKey, currentMonthKey } from '@/src/store/personalStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { monthLabel } from '@/src/screens/personal/utils/monthLabel';
import { calcularArrastre, monedasDelMes } from '@/src/screens/personal/utils/arrastreMensual';
import { ensureRates, readCache, type FxCache } from '@/src/services/fx';
import type { PersonalEntry } from '@/src/types/models';

/**
 * Al cruzar de mes, arma la entrada "carryover" con el sobrante (o excedido)
 * del mes anterior. Sin cambios de comportamiento respecto del original
 * (ADR-005/006) — sólo sacado del componente (PO 2026-09-23).
 *
 * T-256 · EXCEPCIÓN del PO (2026-11-04) a la regla 7: un mes con movimientos en
 * varias monedas se arrastra convirtiendo todo a la moneda del presupuesto con
 * la cotización del cierre («si convertí y llevá»). Sin cotización se pospone.
 *
 * `owedToMe` llega por ref: el efecto sólo debe correr cuando cambia
 * `lastSeenMonth`, no cada vez que cambia la deuda (que se recalcula seguido).
 */
export function useMonthRollover(
  lastSeenMonth: string | undefined, owedToMe: number, movimientos: readonly PersonalEntry[],
) {
  const owedToMeRef = useRef(owedToMe);
  useEffect(() => { owedToMeRef.current = owedToMe; }, [owedToMe]);
  // T-229: el mes anterior se cierra con guardados + derivados (gastos y pagos).
  const movimientosRef = useRef(movimientos);
  useEffect(() => { movimientosRef.current = movimientos; }, [movimientos]);

  const [fx, setFx] = useState<FxCache | null>(() => readCache());
  const pidioRef = useRef<string | null>(null);

  useEffect(() => {
    const thisMonth = currentMonthKey();
    if (!lastSeenMonth || lastSeenMonth >= thisMonth) return;

    const { budget: curBudget, addEntry: add, setLastSeenMonth: setSeen } = usePersonalStore.getState();
    const allEntries = movimientosRef.current;
    const cy = curBudget.currency;

    const alreadyCarried = allEntries.some(
      e => !e.isDeleted && e.kind === 'carryover' && toMonthKey(e.date) === thisMonth,
    );
    if (alreadyCarried) { setSeen(thisMonth); return; }

    const r = calcularArrastre({
      entries: allEntries, month: lastSeenMonth, budget: curBudget,
      owedToMe: owedToMeRef.current, fx,
    });
    if (r.status === 'pendiente') {
      // Sin cotización no se cierra el mes: se pide una vez y, si llega, el
      // efecto vuelve a correr por el cambio de `fx`.
      if (pidioRef.current !== lastSeenMonth) {
        pidioRef.current = lastSeenMonth;
        void ensureRates([cy, ...monedasDelMes(allEntries, lastSeenMonth)], cy).then(setFx);
      }
      return;
    }
    const prevRemaining = r.remaining;

    if (Math.abs(prevRemaining) >= 0.01) {
      const firstOfMonth = new Date(`${thisMonth}-01T12:00:00`).getTime();
      add({
        id:                  uuidv4(),
        kind:                'carryover',
        isPositiveCarryover: prevRemaining > 0,
        description:         `Saldo de ${monthLabel(lastSeenMonth)}`,
        amount:              Math.abs(prevRemaining),
        currency:            cy,
        category:            'other',
        date:                firstOfMonth,
        createdAt:           Date.now(),
        updatedAt:           syncedNow(),
        isDeleted:           false,
      });
    }

    setSeen(thisMonth);
  }, [lastSeenMonth, fx]);
}
