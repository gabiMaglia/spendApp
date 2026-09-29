import { armarTimeline, saldoPendienteDe } from '@/src/screens/groupDetail/detalleDeGrupo';
import type { Expense, Group, Payment } from '@/src/types/models';

/**
 * T-223: lógica pura que vivía dentro de `app/groups/[id].tsx` (760 líneas).
 * Estos tests fijan el comportamiento de antes de la mudanza.
 */

const grupo = (memberIds = ['ana', 'beto']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
  miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500 }, { userId: 'beto', amount: 500 }],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 500, currency: 'ARS',
  date: 0, createdAt: 0, createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

describe('armarTimeline', () => {
  it('mezcla gastos y pagos del grupo, lo más nuevo primero', () => {
    const tl = armarTimeline(
      [gasto({ id: 'e1', date: 10 }), gasto({ id: 'e2', date: 30 })],
      [pago({ id: 'p1', date: 20 })],
      'g1',
    );
    expect(tl.map(i => `${i.type}:${i.data.id}`)).toEqual(['expense:e2', 'payment:p1', 'expense:e1']);
    expect(tl.map(i => i.ts)).toEqual([30, 20, 10]);
  });

  it('deja afuera lo de otros grupos y los tombstones', () => {
    const tl = armarTimeline(
      [gasto({ id: 'otro', groupId: 'g2' }), gasto({ id: 'borrado', isDeleted: true })],
      [pago({ id: 'p-otro', groupId: 'g2' }), pago({ id: 'p-borrado', isDeleted: true })],
      'g1',
    );
    expect(tl).toEqual([]);
  });

  it('sin registros devuelve lista vacía', () => {
    expect(armarTimeline([], [], 'g1')).toEqual([]);
  });

  it('sin id de grupo no matchea nada', () => {
    expect(armarTimeline([gasto()], [pago()], undefined)).toEqual([]);
  });
});

describe('saldoPendienteDe', () => {
  it('devuelve el saldo vivo del miembro, por moneda', () => {
    expect(saldoPendienteDe('beto', [gasto()], [], grupo())).toEqual([{ currency: 'ARS', amount: -500 }]);
  });

  it('un pago que salda deja al miembro sin saldo', () => {
    expect(saldoPendienteDe('beto', [gasto()], [pago()], grupo())).toEqual([]);
  });

  it('ignora gastos de otros grupos', () => {
    expect(saldoPendienteDe('beto', [gasto({ groupId: 'g2' })], [], grupo())).toEqual([]);
  });

  it('un miembro sin movimientos no tiene saldo', () => {
    expect(saldoPendienteDe('caro', [gasto()], [], grupo(['ana', 'beto', 'caro']))).toEqual([]);
  });
});
