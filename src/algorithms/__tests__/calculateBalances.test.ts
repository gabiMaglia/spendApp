import { calculateBalances } from '../calculateBalances';
import type { Expense } from '@/src/types/models';

// Montos en menor unidad (ADR-002) — ej. $100,00 ARS → 10000.

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
      amount: 10000,
      splits: [
        { userId: 'u1', amount: 5000, isPaid: false },
        { userId: 'u2', amount: 5000, isPaid: false },
      ],
    });
    const result = calculateBalances([expense], ['u1', 'u2']);
    const u1 = result.find(b => b.userId === 'u1')!;
    const u2 = result.find(b => b.userId === 'u2')!;

    expect(u1.amount).toBe(5000);   // pagó 10000, debe 5000 → net +5000
    expect(u2.amount).toBe(-5000);  // no pagó, debe 5000 → net -5000
  });

  it('ignores expenses with isDeleted=true', () => {
    const expense = makeExpense({
      paidById: 'u1',
      amount: 10000,
      splits: [
        { userId: 'u1', amount: 5000, isPaid: false },
        { userId: 'u2', amount: 5000, isPaid: false },
      ],
      isDeleted: true,
    });
    const result = calculateBalances([expense], ['u1', 'u2']);
    expect(result.every(b => b.amount === 0)).toBe(true);
  });

  it('handles a group of 4 people correctly', () => {
    // Ana paga $120,00, dividido en partes iguales ($30,00 c/u)
    const expense = makeExpense({
      id: 'exp-ana',
      paidById: 'ana',
      amount: 12000,
      splits: [
        { userId: 'ana',   amount: 3000, isPaid: false },
        { userId: 'bob',   amount: 3000, isPaid: false },
        { userId: 'carla', amount: 3000, isPaid: false },
        { userId: 'diego', amount: 3000, isPaid: false },
      ],
    });
    const result = calculateBalances([expense], ['ana', 'bob', 'carla', 'diego']);
    const get = (id: string) => result.find(b => b.userId === id)!.amount;

    expect(get('ana')).toBe(9000);   // pagó 12000, debe 3000
    expect(get('bob')).toBe(-3000);
    expect(get('carla')).toBe(-3000);
    expect(get('diego')).toBe(-3000);
  });

  it('balances sum to zero exactly (aritmética entera, sin epsilon)', () => {
    const e1 = makeExpense({ id: 'e1', paidById: 'u1', amount: 9000, splits: [
      { userId: 'u1', amount: 3000, isPaid: false },
      { userId: 'u2', amount: 3000, isPaid: false },
      { userId: 'u3', amount: 3000, isPaid: false },
    ]});
    const e2 = makeExpense({ id: 'e2', paidById: 'u2', amount: 6000, splits: [
      { userId: 'u1', amount: 2000, isPaid: false },
      { userId: 'u2', amount: 2000, isPaid: false },
      { userId: 'u3', amount: 2000, isPaid: false },
    ]});
    const result = calculateBalances([e1, e2], ['u1', 'u2', 'u3']);
    const total = result.reduce((sum, b) => sum + b.amount, 0);
    expect(total).toBe(0);
  });

  it('handles a single member group', () => {
    const expense = makeExpense({
      paidById: 'u1',
      amount: 5000,
      splits: [{ userId: 'u1', amount: 5000, isPaid: false }],
    });
    const result = calculateBalances([expense], ['u1']);
    expect(result[0]!.amount).toBe(0);
  });
});

describe('calculateBalances — gastos pagados entre varios (T-025)', () => {
  const base = {
    id: 'e1', groupId: 'g1', description: 'Cena', currency: 'ARS' as const,
    splitMode: 'equal' as const, category: 'food' as const,
    date: 0, createdAt: 0, createdById: 'ua', deletionVotes: [],
    updatedAt: 0, isDeleted: false,
  };

  it('acredita a cada pagador lo que puso, no el total al principal', () => {
    const out = calculateBalances([{
      ...base, amount: 10000, paidById: 'ub',
      payers: [{ userId: 'ua', amount: 4000 }, { userId: 'ub', amount: 6000 }],
      splits: [
        { userId: 'ua', amount: 5000, isPaid: false },
        { userId: 'ub', amount: 5000, isPaid: false },
      ],
    } as any], ['ua', 'ub']);

    const by = Object.fromEntries(out.map(b => [b.userId, b.amount]));
    expect(by.ua).toBe(-1000); // puso 4000, le tocaba 5000
    expect(by.ub).toBe(1000);  // puso 6000, le tocaba 5000
  });

  it('la suma de balances sigue dando cero', () => {
    const out = calculateBalances([{
      ...base, amount: 9999, paidById: 'ua',
      payers: [{ userId: 'ua', amount: 3333 }, { userId: 'ub', amount: 6666 }],
      splits: [
        { userId: 'ua', amount: 3333, isPaid: false },
        { userId: 'ub', amount: 3333, isPaid: false },
        { userId: 'uc', amount: 3333, isPaid: false },
      ],
    } as any], ['ua', 'ub', 'uc']);

    expect(out.reduce((t, b) => t + b.amount, 0)).toBe(0);
  });

  // Compatibilidad: un peer sin actualizar manda gastos sin `payers`
  it('un gasto SIN payers se sigue calculando como antes', () => {
    const out = calculateBalances([{
      ...base, amount: 10000, paidById: 'ua',
      splits: [
        { userId: 'ua', amount: 5000, isPaid: false },
        { userId: 'ub', amount: 5000, isPaid: false },
      ],
    } as any], ['ua', 'ub']);

    const by = Object.fromEntries(out.map(b => [b.userId, b.amount]));
    expect(by.ua).toBe(5000);
    expect(by.ub).toBe(-5000);
  });
});
