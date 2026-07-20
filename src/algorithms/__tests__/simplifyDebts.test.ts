import { simplifyDebts } from '../simplifyDebts';
import type { Balance } from '@/src/types/models';

// Montos en menor unidad (ADR-002) — ej. $50,00 ARS → 5000.

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
      { userId: 'ana', amount: 5000 },
      { userId: 'bob', amount: -5000 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromUserId: 'bob', toUserId: 'ana', amount: 5000 });
  });

  it('minimizes transactions for 4 people (example from ALGORITHMS.md)', () => {
    // Ana +100,00, Bob +50,00, Carlos -80,00, Diana -70,00
    const balances: Balance[] = [
      { userId: 'ana',    amount: 10000 },
      { userId: 'bob',    amount: 5000  },
      { userId: 'carlos', amount: -8000 },
      { userId: 'diana',  amount: -7000 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    expect(result.length).toBeLessThanOrEqual(3);

    // El monto total transferido debe ser exactamente igual al total adeudado
    const totalTransferred = result.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransferred).toBe(15000);
  });

  it('preserves the currency on all transactions', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 10000 },
      { userId: 'u2', amount: -10000 },
    ];
    const result = simplifyDebts(balances, 'USD');
    expect(result[0]!.currency).toBe('USD');
  });

  it('handles a chain of debts (u1→u2→u3)', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 10000 },
      { userId: 'u2', amount: 0     },
      { userId: 'u3', amount: -10000},
    ];
    const result = simplifyDebts(balances, 'ARS');
    // u3 le paga a u1 directamente (u2 ya está saldado)
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fromUserId: 'u3', toUserId: 'u1', amount: 10000 });
  });

  it('handles amounts that do not divide evenly, exact to the minor unit', () => {
    const balances: Balance[] = [
      { userId: 'u1', amount: 3333 },
      { userId: 'u2', amount: 3334 },
      { userId: 'u3', amount: -6667 },
    ];
    const result = simplifyDebts(balances, 'ARS');
    const totalOut = result.filter(t => t.fromUserId === 'u3').reduce((s, t) => s + t.amount, 0);
    expect(totalOut).toBe(6667);
  });
});
