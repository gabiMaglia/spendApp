import { buildCarryOverExpenses } from '../groupCarryOver';
import type { BalanceByCurrency } from '@/src/types/models';

describe('buildCarryOverExpenses', () => {
  it('una sola moneda: un Expense con acreedores como payers y deudores como splits', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 10_000 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: -10_000 }] },
    ];

    const result = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(result).toHaveLength(1);
    const [e] = result;
    expect(e.groupId).toBe('g-nuevo');
    expect(e.currency).toBe('ARS');
    expect(e.amount).toBe(10_000);
    expect(e.payers).toEqual([{ userId: 'ana', amount: 10_000 }]);
    expect(e.splits).toEqual([{ userId: 'beto', amount: 10_000, isPaid: false }]);
    expect(e.description).toBe('Saldo trasladado');
    expect(e.createdById).toBe('ana');
    expect(e.isDeleted).toBe(false);
  });

  it('múltiples monedas: un Expense POR MONEDA, nunca mezcladas', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 5_000 }, { currency: 'USD', amount: -2_000 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: -5_000 }, { currency: 'USD', amount: 2_000 }] },
    ];

    const result = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(result).toHaveLength(2);
    const porMoneda = Object.fromEntries(result.map(e => [e.currency, e]));
    expect(porMoneda.ARS.payers).toEqual([{ userId: 'ana', amount: 5_000 }]);
    expect(porMoneda.USD.payers).toEqual([{ userId: 'beto', amount: 2_000 }]);
  });

  it('una moneda ya saldada en cero no genera Expense', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 0 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: 0 }] },
    ];

    expect(buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana')).toHaveLength(0);
  });

  it('varios acreedores y varios deudores en la misma moneda', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',   balances: [{ currency: 'ARS', amount: 6_000 }] },
      { userId: 'beto',  balances: [{ currency: 'ARS', amount: 4_000 }] },
      { userId: 'carla', balances: [{ currency: 'ARS', amount: -10_000 }] },
    ];

    const [e] = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(e.amount).toBe(10_000);
    expect(e.payers).toEqual(expect.arrayContaining([
      { userId: 'ana', amount: 6_000 },
      { userId: 'beto', amount: 4_000 },
    ]));
    expect(e.splits).toEqual([{ userId: 'carla', amount: 10_000, isPaid: false }]);
  });

  it('invariante: si una moneda no tiene acreedores O no tiene deudores, se ignora (no debería pasar viniendo de calculateBalancesByCurrency, pero no debe crashear)', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana', balances: [{ currency: 'ARS', amount: 500 }] },
    ];

    expect(buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana')).toHaveLength(0);
  });
});
