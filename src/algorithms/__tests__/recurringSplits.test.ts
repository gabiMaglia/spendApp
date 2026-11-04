import { splitsDePlantilla, porcentajesDelReparto } from '../recurringSplits';
import { calcularSplits } from '@/src/screens/expense/repartoDeGasto';
import type { RecurringExpense } from '@/src/types/models';

function plantilla(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 't1', groupId: 'g1', description: 'x', amount: 1000, currency: 'ARS',
    paidById: 'a', splitMode: 'equal', memberIds: ['a', 'b', 'c'], category: 'other',
    rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null, isActive: true,
    createdAt: 0, createdById: 'a', updatedAt: 0, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

/** Lo que la pantalla guarda en la plantilla a partir del reparto que vio el usuario. */
function guardadoPorLaPantalla(amount: number, members: string[], customPercents: string[], same: string) {
  const vistos = calcularSplits({
    amount, members, splitMode: 'percentage',
    percentSub: same ? 'same' : 'custom', samePercent: same, customPercents,
  });
  return { vistos, splitValues: porcentajesDelReparto(vistos) };
}

describe('splitsDePlantilla', () => {
  it('equal: reparte parejo y no degrada', () => {
    const r = splitsDePlantilla(plantilla({ amount: 1000 }));
    expect(r.degradado).toBe(false);
    expect(r.splits.map(s => s.amount).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it.each([
    ['porcentajes distintos con centavos', 1001, ['a', 'b', 'c'], ['33.33', '33.33'], ''],
    ['mismo porcentaje', 1000, ['a', 'b', 'c'], [], '30'],
    ['CLP sin decimales', 10001, ['a', 'b'], ['33.3'], ''],
    ['dos miembros 70/30', 12345, ['a', 'b'], ['70'], ''],
  ])('percentage (%s): la cuota materializada = la de pantalla', (_n, amount, members, custom, same) => {
    const { vistos, splitValues } = guardadoPorLaPantalla(amount, members, custom, same);
    const r = splitsDePlantilla(plantilla({
      amount, memberIds: members, splitMode: 'percentage', splitValues,
    }));
    expect(r.degradado).toBe(false);
    expect(r.splits.map(s => [s.userId, s.amount])).toEqual(vistos.map(s => [s.userId, s.amount]));
  });

  it('percentage sin valores (plantilla vieja): cae a partes iguales y avisa', () => {
    const r = splitsDePlantilla(plantilla({ amount: 1001, splitMode: 'percentage' }));
    expect(r.degradado).toBe(true);
    expect(r.splits.map(s => s.amount).reduce((a, b) => a + b, 0)).toBe(1001);
    expect(r.splits).toHaveLength(3);
  });

  it('valores de largo equivocado o no finitos degradan en vez de tirar', () => {
    expect(splitsDePlantilla(plantilla({ splitMode: 'percentage', splitValues: [50] })).degradado).toBe(true);
    expect(splitsDePlantilla(plantilla({ splitMode: 'percentage', splitValues: [NaN, 50, 50] })).degradado).toBe(true);
  });

  it('shares y custom válidos se respetan; inválidos degradan', () => {
    const sh = splitsDePlantilla(plantilla({ splitMode: 'shares', splitValues: [2, 1, 1], amount: 1000, memberIds: ['a', 'b', 'c'] }));
    expect(sh.degradado).toBe(false);
    expect(sh.splits.map(s => s.amount)).toEqual([500, 250, 250]);
    expect(splitsDePlantilla(plantilla({ splitMode: 'shares' })).degradado).toBe(true);
    expect(splitsDePlantilla(plantilla({ splitMode: 'custom', splitValues: [100, 100], amount: 1000 })).splits.map(s => s.amount))
      .toEqual([100, 100, 800]);
    expect(splitsDePlantilla(plantilla({ splitMode: 'custom' })).degradado).toBe(true);
  });

  it('sin miembros no tira', () => {
    expect(splitsDePlantilla(plantilla({ memberIds: [] })).splits).toEqual([]);
  });
});
