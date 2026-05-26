import { calculateBalances } from '../calculateBalances';
import type { Expense } from '@/src/types/models';

function makeExpense(overrides: Partial<Expense> & Pick<Expense, 'paidById' | 'amount' | 'splits'>): Expense {
  return {
    id: 'exp-1',
    updatedAt: Date.now(),
    isDeleted: false,
    groupId: 'g1',
    description: 'Test',
    currency: 'ARS',
    splitMode: 'equal',
    category: 'other',
    date: Date.now(),
    createdAt: Date.now(),
    createdById: overrides.paidById,
    deletionVotes: [],
    ...overrides,
  };
}

describe('calculateBalances', () => {
  it('returns zero balances when there are no expenses', () => {
    const result = calculateBalances([], ['u1', 'u2']);
    expect(result).toEqual([
      { userId: 'u1', amount: 0 },
      { userId: 'u2', amount: 0 },
    ]);
  });

  it('correctly calculates a simple equal split between 2 people', () => {
    const expense = makeExpense({
      paidById: 'u1',
      amount: 100,
      splits: [
        { userId: 'u1', amount: 50, isPaid: false },
        { userId: 'u2', amount: 50, isPaid: false },
      ],
    });
    const result = calculateBalances([expense], ['u1', 'u2']);
    const u1 = result.find(b => b.userId === 'u1')!;
    const u2 = result.find(b => b.userId === 'u2')!;

    expect(u1.amount).toBe(50);   // pagó 100, debe 50 → net +50
    expect(u2.amount).toBe(-50);  // no pagó, debe 50 → net -50
  });

  it('ignores expenses with isDeleted=true', () => {
    const expense = makeExpense({
      paidById: 'u1',
      amount: 100,
      splits: [
        { userId: 'u1', amount: 50, isPaid: false },
        { userId: 'u2', amount: 50, isPaid: false },
      ],
      isDeleted: true,
    });
    const result = calculateBalances([expense], ['u1', 'u2']);
    expect(result.every(b => b.amount === 0)).toBe(true);
  });

  it('handles a group of 4 people correctly', () => {
    // Ana paga $120, divided equally ($30 each)
    const expense = makeExpense({
      id: 'exp-ana',
      paidById: 'ana',
      amount: 120,
      splits: [
        { userId: 'ana',   amount: 30, isPaid: false },
        { userId: 'bob',   amount: 30, isPaid: false },
        { userId: 'carla', amount: 30, isPaid: false },
        { userId: 'diego', amount: 30, isPaid: false },
      ],
    });
    const result = calculateBalances([expense], ['ana', 'bob', 'carla', 'diego']);
    const get = (id: string) => result.find(b => b.userId === id)!.amount;

    expect(get('ana')).toBe(90);   // pagó 120, debe 30
    expect(get('bob')).toBe(-30);
    expect(get('carla')).toBe(-30);
    expect(get('diego')).toBe(-30);
  });

  it('balances sum to zero', () => {
    const e1 = makeExpense({ id: 'e1', paidById: 'u1', amount: 90, splits: [
      { userId: 'u1', amount: 30, isPaid: false },
      { userId: 'u2', amount: 30, isPaid: false },
      { userId: 'u3', amount: 30, isPaid: false },
    ]});
    const e2 = makeExpense({ id: 'e2', paidById: 'u2', amount: 60, splits: [
      { userId: 'u1', amount: 20, isPaid: false },
      { userId: 'u2', amount: 20, isPaid: false },
      { userId: 'u3', amount: 20, isPaid: false },
    ]});
    const result = calculateBalances([e1, e2], ['u1', 'u2', 'u3']);
    const total = result.reduce((sum, b) => sum + b.amount, 0);
    expect(Math.abs(total)).toBeLessThan(0.01);
  });

  it('handles a single member group', () => {
    const expense = makeExpense({
      paidById: 'u1',
      amount: 50,
      splits: [{ userId: 'u1', amount: 50, isPaid: false }],
    });
    const result = calculateBalances([expense], ['u1']);
    expect(result[0]!.amount).toBe(0);
  });
});
