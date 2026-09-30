import { movimientosDerivados, derivadosDelGrupo } from '@/src/algorithms/movimientosDerivados';
import type { Expense, Group, Payment } from '@/src/types/models';

const YO = 'yo';
const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [YO, 'ana'], miembros: {}, currency: 'ARS',
  createdAt: 0, createdById: YO, updatedAt: 0, isDeleted: false, ...over,
} as Group);
const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 100_000, currency: 'ARS', paidById: YO,
  splits: [{ userId: YO, amount: 50_000, isPaid: false }, { userId: 'ana', amount: 50_000, isPaid: false }],
  splitMode: 'equal', category: 'food', date: 1_000, createdAt: 1_000, createdById: YO,
  updatedAt: 1_000, isDeleted: false, ...over,
} as Expense);
const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: YO, toUserId: 'ana', amount: 20_000, currency: 'ARS',
  date: 2_000, createdAt: 2_000, createdById: YO, updatedAt: 2_000, isDeleted: false, ...over,
} as Payment);
const derivar = (expenses: Expense[], payments: Payment[] = [], groups = [grupo()]) =>
  movimientosDerivados({ expenses, payments, groups, me: YO });

describe('movimientosDerivados (T-229, ADR-006 d3)', () => {
  it('pagué yo: lo que puse ENTERO, no mi porción', () => {
    expect(derivar([gasto()])).toEqual([expect.objectContaining({
      id: 'rep_e1', kind: 'group_replicated', amount: 100_000, currency: 'ARS', date: 1_000,
      category: 'food', description: 'Cena', sourceGroupExpenseId: 'e1', sourceGroupId: 'g1',
      sourceGroupName: 'Viaje', isDeleted: false,
    })]);
  });

  it('pagó otro: nada (es deuda, no gasto)', () => {
    expect(derivar([gasto({ paidById: 'ana' })])).toEqual([]);
  });

  it('varios pagadores: sólo lo que puse yo', () => {
    const e = gasto({ payers: [{ userId: YO, amount: 30_000 }, { userId: 'ana', amount: 70_000 }], paidById: 'ana' });
    expect(derivar([e])[0]).toMatchObject({ id: 'rep_e1', amount: 30_000 });
  });

  it('gasto borrado: nada; restaurado: vuelve', () => {
    expect(derivar([gasto({ isDeleted: true })])).toEqual([]);
    expect(derivar([gasto({ isDeleted: false })])).toHaveLength(1);
  });

  it('gasto editado: el monto nuevo', () => {
    expect(derivar([gasto({ amount: 150_000 })])[0]!.amount).toBe(150_000);
  });

  it('grupo archivado o borrado: sigue contando', () => {
    expect(derivar([gasto()], [], [grupo({ isDeleted: true })])).toHaveLength(1);
    expect(derivar([gasto()], [], [])).toEqual([expect.objectContaining({ sourceGroupName: undefined })]);
  });

  it('gasto personal (groupId vacío): nada, no es de grupo', () => {
    expect(derivar([gasto({ groupId: '' })])).toEqual([]);
  });

  it('recurrente de grupo que pagué: cuenta como cualquier gasto', () => {
    expect(derivar([gasto({ id: 'rec_t1_1000' })])[0]!.id).toBe('rep_rec_t1_1000');
  });

  it('pago que hice: payment_out con la contraparte', () => {
    expect(derivar([], [pago()])).toEqual([expect.objectContaining({
      id: 'pay_p1', kind: 'payment_out', amount: 20_000, date: 2_000, sourcePaymentId: 'p1',
      counterpartId: 'ana', sourceGroupId: 'g1', sourceGroupName: 'Viaje', category: 'other',
    })]);
  });

  it('pago que me hicieron: payment_in', () => {
    expect(derivar([], [pago({ fromUserId: 'ana', toUserId: YO })])[0])
      .toMatchObject({ id: 'pay_p1', kind: 'payment_in', counterpartId: 'ana' });
  });

  it('pago borrado o entre otros dos: nada', () => {
    expect(derivar([], [pago({ isDeleted: true })])).toEqual([]);
    expect(derivar([], [pago({ fromUserId: 'ana', toUserId: 'beto' })])).toEqual([]);
  });
});

describe('derivadosDelGrupo', () => {
  it('sólo los del grupo pedido', () => {
    const otro = gasto({ id: 'e2', groupId: 'g2' });
    const r = derivadosDelGrupo({ expenses: [gasto(), otro], payments: [pago()], groups: [grupo()], me: YO, groupId: 'g1' });
    expect(r.map(x => x.id).sort()).toEqual(['pay_p1', 'rep_e1']);
  });
});
