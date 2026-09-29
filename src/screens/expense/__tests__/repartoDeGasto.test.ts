import { calcularSplits, estadoInicialPorcentajes, formatDate, roundPct } from '@/src/screens/expense/repartoDeGasto';
import type { Expense } from '@/src/types/models';

/**
 * T-223: lógica pura que vivía dentro de `app/expense/new.tsx` (1300 líneas).
 * Estos tests fijan el comportamiento de antes de la mudanza.
 */

const MIEMBROS = ['ana', 'beto', 'caro'];

describe('roundPct', () => {
  it('redondea a dos decimales', () => {
    expect(roundPct(33.33333)).toBe(33.33);
    expect(roundPct(50)).toBe(50);
  });
});

describe('calcularSplits — partes iguales', () => {
  it('sin miembros no hay reparto', () => {
    expect(calcularSplits({ amount: 1000, members: [], splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] })).toEqual([]);
  });

  it('reparte el total exacto y marca el último', () => {
    const s = calcularSplits({ amount: 1000, members: MIEMBROS, splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] });
    expect(s.map(x => x.userId)).toEqual(MIEMBROS);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(1000);
    expect(s.map(x => x.percent)).toEqual([33.33, 33.33, 33.33]);
    expect(s.map(x => x.isLast)).toEqual([false, false, true]);
  });

  it('un solo miembro se lleva todo', () => {
    const s = calcularSplits({ amount: 700, members: ['ana'], splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ userId: 'ana', amount: 700, percent: 100, isLast: true });
  });
});

describe('calcularSplits — porcentaje', () => {
  it('«mismo %»: los primeros llevan ese % y el último el resto', () => {
    const s = calcularSplits({ amount: 1000, members: MIEMBROS, splitMode: 'percentage', percentSub: 'same', samePercent: '30', customPercents: [] });
    expect(s.map(x => x.amount)).toEqual([300, 300, 400]);
    expect(s.map(x => x.percent)).toEqual([30, 30, 40]);
  });

  it('acepta coma decimal', () => {
    const s = calcularSplits({ amount: 1000, members: MIEMBROS, splitMode: 'percentage', percentSub: 'same', samePercent: '25,5', customPercents: [] });
    expect(s[0].percent).toBe(25.5);
    expect(s[2].percent).toBe(49);
  });

  it('«personalizado»: cada uno su %, el último cierra EXACTO contra el total', () => {
    const s = calcularSplits({ amount: 999, members: MIEMBROS, splitMode: 'percentage', percentSub: 'custom', samePercent: '', customPercents: ['50', '20'] });
    expect(s.map(x => x.percent)).toEqual([50, 20, 30]);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(999);
  });

  it('si los % pasan de 100, el resto del último queda negativo', () => {
    const s = calcularSplits({ amount: 1000, members: MIEMBROS, splitMode: 'percentage', percentSub: 'custom', samePercent: '', customPercents: ['60', '60'] });
    expect(s[2].percent).toBe(-20);
  });

  it('un % vacío o inválido cuenta como 0', () => {
    const s = calcularSplits({ amount: 1000, members: MIEMBROS, splitMode: 'percentage', percentSub: 'custom', samePercent: '', customPercents: ['', 'abc'] });
    expect(s.map(x => x.percent)).toEqual([0, 0, 100]);
  });
});

describe('estadoInicialPorcentajes', () => {
  const gasto = (amounts: number[]) => ({
    amount: amounts.reduce((a, b) => a + b, 0),
    splitMode: 'percentage',
    splits: amounts.map((amount, i) => ({ userId: MIEMBROS[i], amount, isPaid: false })),
  }) as unknown as Expense;

  it('sin gasto previo: partes iguales', () => {
    expect(estadoInicialPorcentajes(undefined)).toEqual({ splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] });
  });

  it('gasto en partes iguales: partes iguales', () => {
    const g = { ...gasto([500, 500]), splitMode: 'equal' } as Expense;
    expect(estadoInicialPorcentajes(g).splitMode).toBe('equal');
  });

  it('porcentaje con todos iguales: «mismo %»', () => {
    expect(estadoInicialPorcentajes(gasto([300, 300, 400]))).toEqual({
      splitMode: 'percentage', percentSub: 'same', samePercent: '30', customPercents: ['30', '30'],
    });
  });

  it('porcentaje distinto: «personalizado»', () => {
    expect(estadoInicialPorcentajes(gasto([500, 200, 300]))).toEqual({
      splitMode: 'percentage', percentSub: 'custom', samePercent: '50', customPercents: ['50', '20'],
    });
  });

  it('monto 0: no hay % que reconstruir', () => {
    expect(estadoInicialPorcentajes({ ...gasto([0, 0]), amount: 0 } as Expense).splitMode).toBe('equal');
  });
});

describe('formatDate', () => {
  it('hoy y ayer con nombre; el resto con fecha corta', () => {
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    const antes = new Date(); antes.setDate(hoy.getDate() - 5);
    expect(formatDate(hoy)).toBe('Hoy');
    expect(formatDate(ayer)).toBe('Ayer');
    expect(formatDate(antes)).not.toMatch(/^(Hoy|Ayer)$/);
  });
});
