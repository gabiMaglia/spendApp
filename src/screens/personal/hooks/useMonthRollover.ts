import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePersonalStore, toMonthKey, currentMonthKey } from '@/src/store/personalStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { monthLabel } from '@/src/screens/personal/utils/monthLabel';

/**
 * Al cruzar de mes, arma la entrada "carryover" con el sobrante (o excedido)
 * del mes anterior. Sin cambios de comportamiento respecto del original
 * (ADR-005/006) — sólo sacado del componente (PO 2026-09-23).
 *
 * `owedToMe` llega por ref: el efecto sólo debe correr cuando cambia
 * `lastSeenMonth`, no cada vez que cambia la deuda (que se recalcula seguido).
 */
export function useMonthRollover(lastSeenMonth: string | undefined, owedToMe: number) {
  const owedToMeRef = useRef(owedToMe);
  useEffect(() => { owedToMeRef.current = owedToMe; }, [owedToMe]);

  useEffect(() => {
    const thisMonth = currentMonthKey();
    if (!lastSeenMonth || lastSeenMonth >= thisMonth) return;

    const { entries: allEntries, budget: curBudget, addEntry: add, setLastSeenMonth: setSeen } =
      usePersonalStore.getState();
    const cy = curBudget.currency;

    const alreadyCarried = allEntries.some(
      e => !e.isDeleted && e.kind === 'carryover' && toMonthKey(e.date) === thisMonth,
    );
    if (alreadyCarried) { setSeen(thisMonth); return; }

    const prevEntries = allEntries.filter(
      e => !e.isDeleted && e.currency === cy && toMonthKey(e.date) === lastSeenMonth,
    );

    const prevIncome   = prevEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
    const prevExpense  = prevEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
    const prevGroup    = prevEntries.filter(e => e.kind === 'group_replicated').reduce((s, e) => s + e.amount, 0);
    const prevPosCarry = prevEntries.filter(e => e.kind === 'carryover' && e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);
    const prevNegCarry = prevEntries.filter(e => e.kind === 'carryover' && !e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);

    const prevEffective = curBudget.monthlyAmount + prevIncome + prevPosCarry +
      (curBudget.includeOwedToMe ? owedToMeRef.current : 0);
    const prevSpent     = prevExpense + prevGroup + prevNegCarry;
    const prevRemaining = prevEffective - prevSpent;

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
  }, [lastSeenMonth]);
}
