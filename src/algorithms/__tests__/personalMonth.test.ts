import {
  bucketDe, repartirDelMes, BALDES_GASTADOS, BALDES_DISPONIBLES,
} from '../personalMonth';
import type { PersonalEntry } from '@/src/types/models';

/**
 * **El bug que reportó el PO probando en device (T-063):** el sobrante del mes
 * anterior aparecía como GASTADO en el dashboard.
 *
 * Las dos pantallas clasificaban por su cuenta. Personal separaba el carryover
 * por signo; el dashboard usaba `kind !== 'income'`, que barre todo lo que no
 * sea un ingreso — carryover positivo incluido. El sobrante se contaba **dos
 * veces mal**: sumaba a lo gastado y además no se acreditaba en lo disponible.
 * Quien venía de un mes ahorrativo veía su ahorro como gasto.
 */
const e = (over: Partial<PersonalEntry>): PersonalEntry => ({
  id: 'p1', kind: 'expense', description: 'x', amount: 1000, currency: 'ARS',
  date: 1, createdAt: 1, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

describe('el sobrante del mes pasado NO es un gasto', () => {
  it('el carryover positivo va del lado del presupuesto', () => {
    const sobrante = e({ kind: 'carryover', isPositiveCarryover: true });
    expect(bucketDe(sobrante)).toBe('carryPos');
    expect(BALDES_DISPONIBLES).toContain('carryPos');
    expect(BALDES_GASTADOS).not.toContain('carryPos');
  });

  it('el carryover NEGATIVO sí es gasto: es deuda que se trae', () => {
    const arrastre = e({ kind: 'carryover', isPositiveCarryover: false });
    expect(bucketDe(arrastre)).toBe('carryNeg');
    expect(BALDES_GASTADOS).toContain('carryNeg');
    expect(BALDES_DISPONIBLES).not.toContain('carryNeg');
  });

  it('sin la bandera, un carryover se trata como arrastre negativo', () => {
    // Es el lado conservador: contarlo como sobrante regalaría presupuesto.
    expect(bucketDe(e({ kind: 'carryover' }))).toBe('carryNeg');
  });

  it('los otros tres van donde corresponde', () => {
    expect(bucketDe(e({ kind: 'income' }))).toBe('income');
    expect(bucketDe(e({ kind: 'expense' }))).toBe('expense');
    expect(bucketDe(e({ kind: 'group_replicated' }))).toBe('group');
  });

  /**
   * El guard de la clase: `kind !== 'income'` definía por DESCARTE, así que cada
   * `kind` nuevo entraba solo del lado equivocado y en silencio. Ningún balde
   * puede estar en los dos lados, y ninguno puede quedar sin lado.
   */
  it('cada balde está de un lado y de uno solo', () => {
    const todos = ['income', 'expense', 'group', 'carryPos', 'carryNeg'] as const;
    for (const b of todos) {
      const enGastado    = BALDES_GASTADOS.includes(b);
      const enDisponible = BALDES_DISPONIBLES.includes(b);
      expect(enGastado && enDisponible).toBe(false);   // nunca en los dos
      if (b !== 'income') expect(enGastado || enDisponible).toBe(true);
    }
  });
});

describe('repartirDelMes', () => {
  it('reparte sin perder ni duplicar', () => {
    const lista = [
      e({ id: 'a', kind: 'income' }),
      e({ id: 'b', kind: 'expense' }),
      e({ id: 'c', kind: 'group_replicated' }),
      e({ id: 'd', kind: 'carryover', isPositiveCarryover: true }),
      e({ id: 'f', kind: 'carryover', isPositiveCarryover: false }),
    ];
    const r = repartirDelMes(lista);
    const total = Object.values(r).reduce((n, xs) => n + xs.length, 0);
    expect(total).toBe(lista.length);
    expect(r.carryPos.map(x => x.id)).toEqual(['d']);
  });

  it('sin movimientos, los cinco baldes existen y están vacíos', () => {
    const r = repartirDelMes([]);
    expect(Object.keys(r).sort()).toEqual(['carryNeg', 'carryPos', 'expense', 'group', 'income']);
  });
});
