import { simplifyDebts } from '../simplifyDebts';
import type { Balance } from '@/src/types/models';

describe('simplifyDebts', () => {
  it('returns empty array when all balances are zero', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 0 },
      { userId: 'u2', amount: 0 },
    ];
    expect(simplifyDebts(balances, 'ARS')).toEqual([]);
  });

  it('generates one transaction for two people', () => {
    const balances: Balance[] = [
      { userId: 'ana', amount: 50 },
      { userId: 'bob', amount: -50 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromUserId: 'bob', toUserId: 'ana', amount: 50 });
  });

  it('minimizes transactions for 4 people (example from ALGORITHMS.md)', () => {
    // Ana +100, Bob +50, Carlos -80, Diana -70
    const balances: Balance[] = [
      { userId: 'ana',    amount: 100 },
      { userId: 'bob',    amount: 50  },
      { userId: 'carlos', amount: -80 },
      { userId: 'diana',  amount: -70 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    expect(result.length).toBeLessThanOrEqual(3);

    // The total amount transferred must equal the total owed
    const totalTransferred = result.reduce((sum, t) => sum + t.amount, 0);
    expect(Math.abs(totalTransferred - 150)).toBeLessThan(0.01);
  });

  it('preserves the currency on all transactions', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 100 },
      { userId: 'u2', amount: -100 },
    ];
    const result = simplifyDebts(balances, 'USD');
    expect(result[0]!.currency).toBe('USD');
  });

  it('handles a chain of debts (u1→u2→u3)', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 100 },
      { userId: 'u2', amount: 0   },
      { userId: 'u3', amount: -100},
    ];
    const result = simplifyDebts(balances, 'ARS');
    // u3 pays u1 directly (u2 is already settled)
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromUserId: 'u3', toUserId: 'u1', amount: 100 });
  });

  it('handles fractional amounts correctly', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 33.33 },
      { userId: 'u2', amount: 33.34 },
      { userId: 'u3', amount: -66.67 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    const totalOut = result.filter(t => t.fromUserId === 'u3').reduce((s, t) => s + t.amount, 0);
    expect(Math.abs(totalOut - 66.67)).toBeLessThan(0.02);
  });
});
