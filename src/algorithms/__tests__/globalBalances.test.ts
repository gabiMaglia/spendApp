import { calculateGlobalBalances } from '../globalBalances';
import type { Expense, Group, Payment } from '@/src/types/models';

// Montos en menor unidad (ADR-002): ARS/USD factor 100 → $50,00 = 5000.

function makeGroup(over: Partial<Group> & Pick<Group, 'id' | 'memberIds'>): Group {
  return {
    name: 'G',
    currency: 'ARS',
    createdAt: 0,
    createdById: over.memberIds[0],
    deletionVotes: [],
    updatedAt: 0,
    isDeleted: false,
    ...over,
  };
}

function makeExpense(
  over: Partial<Expense> & Pick<Expense, 'groupId' | 'paidById' | 'amount' | 'splits'>,
): Expense {
  return {
    id: 'e1',
    updatedAt: 0,
    isDeleted: false,
    description: 'Test',
    currency: 'ARS',
    splitMode: 'equal',
    category: 'other',
    date: 0,
    createdAt: 0,
    createdById: over.paidById,
    deletionVotes: [],
    ...over,
  };
}

function makePayment(
  over: Partial<Payment> & Pick<Payment, 'groupId' | 'fromUserId' | 'toUserId' | 'amount'>,
): Payment {
  return {
    id: 'p1',
    currency: 'ARS',
    date: 0,
    createdAt: 0,
    createdById: over.fromUserId,
    updatedAt: 0,
    isDeleted: false,
    ...over,
  };
}

const splitEqual = (a: string, b: string, half: number): Expense['splits'] => [
  { userId: a, amount: half, isPaid: false },
  { userId: b, amount: half, isPaid: false },
];

describe('calculateGlobalBalances', () => {
  it('sin grupos → sin balances', () => {
    expect(calculateGlobalBalances([], [], [], 'u1')).toEqual([]);
  });

  it('un gasto simple: el que no pagó le debe al que pagó', () => {
    const g = makeGroup({ id: 'g1', memberIds: ['u1', 'u2'] });
    const e = makeExpense({ groupId: 'g1', paidById: 'u1', amount: 10000, splits: splitEqual('u1', 'u2', 5000) });

    // Desde u1 (pagó): u2 te debe +5000
    const fromU1 = calculateGlobalBalances([g], [e], [], 'u1');
    expect(fromU1).toEqual([{ userId: 'u2', byCurrency: [{ currency: 'ARS', amount: 5000 }] }]);

    // Desde u2 (no pagó): le debés a u1 → -5000
    const fromU2 = calculateGlobalBalances([g], [e], [], 'u2');
    expect(fromU2).toEqual([{ userId: 'u1', byCurrency: [{ currency: 'ARS', amount: -5000 }] }]);
  });

  it('un pago que salda la deuda deja balance neto 0 (se filtra)', () => {
    const g = makeGroup({ id: 'g1', memberIds: ['u1', 'u2'] });
    const e = makeExpense({ groupId: 'g1', paidById: 'u1', amount: 10000, splits: splitEqual('u1', 'u2', 5000) });
    const p = makePayment({ groupId: 'g1', fromUserId: 'u2', toUserId: 'u1', amount: 5000 });

    expect(calculateGlobalBalances([g], [e], [p], 'u1')).toEqual([]);
    expect(calculateGlobalBalances([g], [e], [p], 'u2')).toEqual([]);
  });

  it('ignora grupos y gastos borrados', () => {
    const gDel = makeGroup({ id: 'g1', memberIds: ['u1', 'u2'], isDeleted: true });
    const eInDeletedGroup = makeExpense({ groupId: 'g1', paidById: 'u1', amount: 10000, splits: splitEqual('u1', 'u2', 5000) });
    expect(calculateGlobalBalances([gDel], [eInDeletedGroup], [], 'u1')).toEqual([]);

    const g = makeGroup({ id: 'g2', memberIds: ['u1', 'u2'] });
    const eDel = makeExpense({ id: 'e2', groupId: 'g2', paidById: 'u1', amount: 10000, splits: splitEqual('u1', 'u2', 5000), isDeleted: true });
    expect(calculateGlobalBalances([g], [eDel], [], 'u1')).toEqual([]);
  });

  it('separa por moneda (nunca mezcla)', () => {
    const g = makeGroup({ id: 'g1', memberIds: ['u1', 'u2'] });
    const eArs = makeExpense({ id: 'eA', groupId: 'g1', paidById: 'u1', amount: 10000, currency: 'ARS', splits: splitEqual('u1', 'u2', 5000) });
    const eUsd = makeExpense({ id: 'eU', groupId: 'g1', paidById: 'u1', amount: 2000, currency: 'USD', splits: splitEqual('u1', 'u2', 1000) });

    const res = calculateGlobalBalances([g], [eArs, eUsd], [], 'u1');
    expect(res).toHaveLength(1);
    expect(res[0].userId).toBe('u2');
    const byCur = res[0].byCurrency.sort((a, b) => a.currency.localeCompare(b.currency));
    expect(byCur).toEqual([
      { currency: 'ARS', amount: 5000 },
      { currency: 'USD', amount: 1000 },
    ]);
  });
});
