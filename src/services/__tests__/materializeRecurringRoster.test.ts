import { materializeRecurring } from '../materializeRecurring';
import type { RecurringExpense } from '@/src/types/models';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12).getTime();

function template(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 't1', groupId: 'g1', description: 'Alquiler', amount: 30000, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub', 'uc'], category: 'home',
    rule: { frequency: 'monthly', startDate: d(2026, 1, 10) },
    lastMaterializedAt: null, isActive: true,
    createdAt: d(2026, 1, 1), createdById: 'ua', updatedAt: 0, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

// T-262: quien ya salió o fue expulsado no puede aparecer en las cuotas nuevas.
describe('materializeRecurring — miembros vigentes (T-262)', () => {
  const now = d(2026, 2, 15);

  it('con todos los miembros vigentes materializa igual que antes', () => {
    const r = materializeRecurring([template()], now, { g1: ['ua', 'ub', 'uc'] });
    expect(r.expenses[0]!.splits.map(s => s.userId)).toEqual(['ua', 'ub', 'uc']);
    expect(r.problems).toEqual([]);
  });

  it('reparte sólo entre los vigentes cuando alguien salió (equal) y la suma cierra', () => {
    const r = materializeRecurring([template()], now, { g1: ['ua', 'ub'] });
    expect(r.expenses).toHaveLength(2);
    for (const e of r.expenses) {
      expect(e.splits.map(s => s.userId).sort()).toEqual(['ua', 'ub']);
      expect(e.splits.reduce((t, s) => t + s.amount, 0)).toBe(30000);
    }
    expect(r.updatedTemplates).toHaveLength(1);
  });

  it('un reparto no igual con baja pasa a partes iguales entre los vigentes y lo avisa', () => {
    const t = template({ splitMode: 'percentage', splitValues: [50, 30, 20] });
    const r = materializeRecurring([t], now, { g1: ['ua', 'ub'] });
    expect(r.expenses[0]!.splits.map(s => s.amount)).toEqual([15000, 15000]);
    expect(r.expenses[0]!.splitMode).toBe('equal');
    expect(r.problems.map(p => p.kind)).toEqual(['miembros']);
  });

  it('si el pagador ya no está, no materializa, no avanza la plantilla y lo deja anotado', () => {
    const r = materializeRecurring([template({ paidById: 'uc' })], now, { g1: ['ua', 'ub'] });
    expect(r.expenses).toHaveLength(0);
    expect(r.updatedTemplates).toHaveLength(0);
    expect(r.problems).toEqual([expect.objectContaining({ id: 't1', kind: 'omitido' })]);
  });

  it('si algún pagador del desglose ya no está, tampoco materializa', () => {
    const payers = [{ userId: 'ua', amount: 10000 }, { userId: 'uc', amount: 20000 }];
    const r = materializeRecurring([template({ payers })], now, { g1: ['ua', 'ub'] });
    expect(r.expenses).toHaveLength(0);
    expect(r.problems[0]!.kind).toBe('omitido');
  });

  it('si no queda ningún participante vigente, no materializa', () => {
    const r = materializeRecurring([template({ memberIds: ['uc'] })], now, { g1: ['ua', 'ub'] });
    expect(r.expenses).toHaveLength(0);
    expect(r.problems[0]!.kind).toBe('omitido');
  });

  it('un grupo que no está en los rosters (no se puede verificar) se comporta como antes', () => {
    const r = materializeRecurring([template()], now, { otro: ['ua'] });
    expect(r.expenses[0]!.splits).toHaveLength(3);
  });

  it('sin rosters se comporta como antes', () => {
    const r = materializeRecurring([template()], now);
    expect(r.expenses[0]!.splits).toHaveLength(3);
  });

  it('una plantilla omitida no frena a las otras', () => {
    const r = materializeRecurring(
      [template({ paidById: 'uc' }), template({ id: 't2' })], now, { g1: ['ua', 'ub'] });
    expect(r.updatedTemplates.map(u => u.id)).toEqual(['t2']);
  });

  it('las plantillas personales ignoran los rosters', () => {
    const r = materializeRecurring([template({ groupId: '' })], now, { g1: [] });
    expect(r.personalEntries).toHaveLength(2);
  });
});
