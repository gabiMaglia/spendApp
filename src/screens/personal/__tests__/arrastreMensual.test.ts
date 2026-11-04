import { calcularArrastre } from '@/src/screens/personal/utils/arrastreMensual';
import type { FxCache } from '@/src/services/fx';
import type { PersonalEntry, PersonalBudget } from '@/src/types/models';

const MES = '2026-10';
const FECHA = new Date('2026-10-15T12:00:00').getTime();
const budget: PersonalBudget = { currency: 'ARS', monthlyAmount: 100_000, includeOwedToMe: false };
// 1 USD = 1000 ARS
const fx: FxCache = { base: 'USD', rates: { USD: 1, ARS: 1000, EUR: 0.9 }, fetchedAt: 1, nextUpdateAt: 0 };

const e = (p: Partial<PersonalEntry>): PersonalEntry => ({
  id: Math.random().toString(), kind: 'expense', description: 'x', amount: 0, currency: 'ARS',
  category: 'other', date: FECHA, createdAt: FECHA, updatedAt: FECHA, isDeleted: false, ...p,
} as PersonalEntry);

const base = { month: MES, budget, owedToMe: 0 };

describe('calcularArrastre (T-256)', () => {
  it('mes sólo en la moneda del presupuesto: presupuesto + ingresos - gastos', () => {
    const r = calcularArrastre({ ...base, fx: null, entries: [
      e({ kind: 'income', amount: 50_000 }), e({ kind: 'expense', amount: 30_000 }),
    ] });
    expect(r).toEqual({ status: 'ok', remaining: 120_000 });
  });

  it('no necesita cotizaciones si todo está en la moneda del presupuesto', () => {
    expect(calcularArrastre({ ...base, fx: null, entries: [] })).toEqual({ status: 'ok', remaining: 100_000 });
  });

  it('mes mixto ARS + USD: convierte la otra moneda y suma', () => {
    // 10,00 USD de gasto = 10.000,00 ARS = 1.000.000 centavos
    const r = calcularArrastre({ ...base, fx, entries: [
      e({ kind: 'expense', amount: 20_000 }), e({ kind: 'expense', amount: 1_000, currency: 'USD' }),
    ] });
    expect(r).toEqual({ status: 'ok', remaining: 100_000 - 20_000 - 1_000_000 });
  });

  it('ingresos y carryover en otra moneda también entran, con su signo', () => {
    const r = calcularArrastre({ ...base, fx, entries: [
      e({ kind: 'income', amount: 100, currency: 'USD' }),
      e({ kind: 'carryover', isPositiveCarryover: false, amount: 50_000 }),
    ] });
    expect(r).toEqual({ status: 'ok', remaining: 100_000 + 100_000 - 50_000 });
  });

  it('lo que me deben suma sólo si el presupuesto lo incluye', () => {
    const conDeuda = { ...base, owedToMe: 7_000, fx: null, entries: [] };
    expect(calcularArrastre(conDeuda)).toEqual({ status: 'ok', remaining: 100_000 });
    expect(calcularArrastre({ ...conDeuda, budget: { ...budget, includeOwedToMe: true } }))
      .toEqual({ status: 'ok', remaining: 107_000 });
  });

  it('ignora borradas y otros meses', () => {
    const r = calcularArrastre({ ...base, fx: null, entries: [
      e({ amount: 9_000, isDeleted: true }),
      e({ amount: 9_000, date: new Date('2026-09-15T12:00:00').getTime() }),
    ] });
    expect(r).toEqual({ status: 'ok', remaining: 100_000 });
  });

  it('sin cotizaciones para una moneda presente: pendiente, no un número incompleto', () => {
    const entries = [e({ amount: 1_000, currency: 'USD' })];
    expect(calcularArrastre({ ...base, fx: null, entries })).toEqual({ status: 'pendiente' });
    expect(calcularArrastre({ ...base, fx: { ...fx, rates: { ARS: 1000 } }, entries })).toEqual({ status: 'pendiente' });
  });

  it('redondea al entero más cercano sobre el total convertido', () => {
    const r = calcularArrastre({ ...base, budget: { ...budget, monthlyAmount: 0 }, fx, entries: [
      e({ kind: 'income', amount: 1, currency: 'EUR' }),
    ] });
    // 0,01 EUR / 0.9 * 1000 = 11,11 ARS = 1111,1 centavos -> 1111
    expect(r).toEqual({ status: 'ok', remaining: 1111 });
  });
});
