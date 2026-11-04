import { materializeRecurring } from '../materializeRecurring';
import { occurrenceAt } from '@/src/algorithms/recurrence';
import type { RecurringExpense } from '@/src/types/models';

// T-263 (QA): la IDENTIDAD de la cuota no puede depender del huso del aparato,
// porque cada aparato materializa y el merge colapsa por id. Los valores son
// constantes precalculadas con la fórmula UTC original (= ids ya emitidos en
// producción). Se corre con TZ=America/Argentina/Buenos_Aires y America/Santiago.
// Ancla: 30-ene 22:00 de Argentina = 31-ene 01:00 UTC, mensual (caso de fin de mes).
const START = Date.UTC(2026, 0, 31, 1, 0);
const LEGACY = [1769821200000, 1772240400000, 1774918800000, 1777510800000];

const template = (over: Partial<RecurringExpense> = {}) => ({
  id: 't1', groupId: 'g1', description: 'Alquiler', amount: 1000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub'], category: 'home',
  rule: { frequency: 'monthly', startDate: START },
  lastMaterializedAt: null, isActive: true,
  createdAt: 0, createdById: 'ua', updatedAt: 0, isDeleted: false,
  ...over,
}) as RecurringExpense;

describe('identidad de la cuota independiente del huso (T-263)', () => {
  const now = Date.UTC(2026, 3, 30, 12);

  it('los ids y el updatedAt son los de la fórmula UTC vieja', () => {
    const r = materializeRecurring([template()], now);
    expect(r.expenses.map(e => e.id)).toEqual(LEGACY.map(a => `rec_t1_${a}`));
    expect(r.expenses.map(e => e.updatedAt)).toEqual(LEGACY);
    expect(r.updatedTemplates).toEqual([{ id: 't1', lastMaterializedAt: LEGACY[3] }]);
  });

  it('la fecha visible es la local de la ocurrencia', () => {
    const r = materializeRecurring([template()], now);
    r.expenses.forEach((e, n) => {
      expect(e.date).toBe(occurrenceAt(template().rule, n));
      expect(e.createdAt).toBe(e.date);
    });
  });

  it('transición: con last calculado con la fórmula vieja no agrega ni salta cuotas', () => {
    const r = materializeRecurring([template({ lastMaterializedAt: LEGACY[1]! })], now);
    expect(r.expenses.map(e => e.id)).toEqual([`rec_t1_${LEGACY[2]}`, `rec_t1_${LEGACY[3]}`]);
  });

  it('con last en la última cuota no genera nada', () => {
    const r = materializeRecurring([template({ lastMaterializedAt: LEGACY[3]! })], now);
    expect(r.expenses).toHaveLength(0);
  });
});
