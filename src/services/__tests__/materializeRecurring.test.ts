import { materializeRecurring } from '../materializeRecurring';
import type { RecurringExpense } from '@/src/types/models';

const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);

function template(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 't1', groupId: 'g1', description: 'Alquiler', amount: 50000, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub'], category: 'home',
    rule: { frequency: 'monthly', startDate: d(2026, 1, 10) },
    lastMaterializedAt: null, isActive: true,
    createdAt: d(2026, 1, 1), createdById: 'ua', updatedAt: 0, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

describe('materializeRecurring', () => {
  it('crea un gasto por vencimiento vencido', () => {
    const r = materializeRecurring([template()], d(2026, 3, 15));
    expect(r.expenses).toHaveLength(3);
    expect(r.expenses[0]!.description).toBe('Alquiler');
  });

  it('cada gasto lleva la fecha de SU vencimiento, no la de hoy', () => {
    const r = materializeRecurring([template()], d(2026, 3, 15));
    expect(r.expenses.map(e => new Date(e.date).toISOString().slice(0, 10)))
      .toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('reparte con el modo de la plantilla y la suma cierra', () => {
    const r = materializeRecurring([template({ amount: 50001 })], d(2026, 1, 15));
    const e = r.expenses[0]!;
    expect(e.splits).toHaveLength(2);
    expect(e.splits.reduce((t, s) => t + s.amount, 0)).toBe(50001);
  });

  it('avanza lastMaterializedAt al último vencimiento', () => {
    const r = materializeRecurring([template()], d(2026, 3, 15));
    expect(r.updatedTemplates).toEqual([{ id: 't1', lastMaterializedAt: d(2026, 3, 10) }]);
  });

  // IDEMPOTENCIA — abrir la app dos veces no puede duplicar
  it('correrlo de nuevo con el lastMaterializedAt actualizado no crea nada', () => {
    const now = d(2026, 3, 15);
    const first = materializeRecurring([template()], now);
    const second = materializeRecurring(
      [template({ lastMaterializedAt: first.updatedTemplates[0]!.lastMaterializedAt })],
      now,
    );
    expect(second.expenses).toHaveLength(0);
    expect(second.updatedTemplates).toHaveLength(0);
  });

  it('los ids son deterministas: dos devices generan el MISMO id y el merge los colapsa', () => {
    const a = materializeRecurring([template()], d(2026, 2, 15));
    const b = materializeRecurring([template()], d(2026, 2, 15));
    expect(a.expenses.map(e => e.id)).toEqual(b.expenses.map(e => e.id));
  });

  it('ignora plantillas pausadas', () => {
    const r = materializeRecurring([template({ isActive: false })], d(2026, 3, 15));
    expect(r.expenses).toHaveLength(0);
  });

  it('ignora plantillas borradas (tombstone)', () => {
    const r = materializeRecurring([template({ isDeleted: true })], d(2026, 3, 15));
    expect(r.expenses).toHaveLength(0);
  });

  it('sin grupo genera movimiento personal en vez de gasto de grupo', () => {
    const r = materializeRecurring([template({ groupId: '' })], d(2026, 2, 15));
    expect(r.expenses).toHaveLength(0);
    expect(r.personalEntries).toHaveLength(2);
    expect(r.personalEntries[0]!.kind).toBe('expense');
  });

  it('procesa varias plantillas de una', () => {
    const r = materializeRecurring(
      [template(), template({ id: 't2', description: 'Internet' })],
      d(2026, 2, 15),
    );
    expect(r.expenses).toHaveLength(4);
    expect(r.updatedTemplates).toHaveLength(2);
  });

  it('una plantilla que todavía no arrancó no genera nada', () => {
    const r = materializeRecurring(
      [template({ rule: { frequency: 'monthly', startDate: d(2027, 1, 1) } })],
      d(2026, 6, 1),
    );
    expect(r.expenses).toHaveLength(0);
  });

  it('respeta el endDate y deja de generar', () => {
    const r = materializeRecurring(
      [template({ rule: { frequency: 'monthly', startDate: d(2026, 1, 10), endDate: d(2026, 2, 10) } })],
      d(2026, 12, 1),
    );
    expect(r.expenses).toHaveLength(2);
  });

  // RECUPERACIÓN — la app estuvo cerrada meses
  it('tras meses sin abrir la app aparecen TODOS los vencidos', () => {
    const r = materializeRecurring([template({ lastMaterializedAt: d(2026, 1, 10) })], d(2026, 6, 15));
    expect(r.expenses).toHaveLength(5);
  });
});
