import { sumConverted } from '../fxTotals';
import type { FxCache } from '../fx';

const RATES = { USD: 1, ARS: 1513.0352, BRL: 5.164256, CLP: 925.290443 };
const cache: FxCache = {
  base: 'USD', rates: RATES, fetchedAt: 1_788_048_151_000, nextUpdateAt: 1_788_134_781_000,
};

describe('sumConverted', () => {
  it('todo en la moneda elegida: suma directa, sin tocar cotizaciones', () => {
    const r = sumConverted([
      { currency: 'ARS', minor: 10_000 },
      { currency: 'ARS', minor: 2_500 },
    ], 'ARS', null);
    expect(r.totalMinor).toBe(12_500);
    expect(r.unconverted).toEqual([]);
  });

  it('convierte lo que puede y suma en la moneda elegida', () => {
    const r = sumConverted([
      { currency: 'ARS', minor: 100_000 },   // 1.000 ARS
      { currency: 'BRL', minor: 10_000 },    // 100 BRL
    ], 'ARS', cache);
    const brlEnArs = Math.round((10_000 / 100 / 5.164256) * 1513.0352 * 100);
    expect(r.totalMinor).toBe(100_000 + brlEnArs);
    expect(r.unconverted).toEqual([]);
  });

  it('lo que NO se puede convertir NO se suma: se devuelve aparte, en su moneda', () => {
    // Sin cache y con dos monedas: lo ajeno queda afuera del total, nunca en 0.
    const r = sumConverted([
      { currency: 'ARS', minor: 100_000 },
      { currency: 'BRL', minor: 10_000 },
    ], 'ARS', null);
    expect(r.totalMinor).toBe(100_000);
    expect(r.unconverted).toEqual([{ currency: 'BRL', minor: 10_000 }]);
  });

  it('agrupa lo no convertible por moneda, no una fila por gasto', () => {
    const r = sumConverted([
      { currency: 'BRL', minor: 1_000 },
      { currency: 'BRL', minor: 2_000 },
      { currency: 'CLP', minor: 500 },
    ], 'ARS', null);
    expect(r.totalMinor).toBe(0);
    expect(r.unconverted).toEqual([
      { currency: 'BRL', minor: 3_000 },
      { currency: 'CLP', minor: 500 },
    ]);
  });

  it('una moneda sin tasa cae a no-convertible aunque haya cache', () => {
    const r = sumConverted([
      { currency: 'ARS', minor: 100_000 },
      { currency: 'PYG', minor: 50_000 },   // no esta en RATES
    ], 'ARS', cache);
    expect(r.totalMinor).toBe(100_000);
    expect(r.unconverted).toEqual([{ currency: 'PYG', minor: 50_000 }]);
  });

  it('lista vacia: cero y nada pendiente', () => {
    expect(sumConverted([], 'ARS', cache)).toEqual({ totalMinor: 0, unconverted: [] });
  });

  it('un total que da 0 con plata no convertible NO es un cero legitimo', () => {
    // Este es el invariante: la pantalla tiene que poder distinguir "no gastaste
    // nada" de "no te puedo mostrar lo que gastaste".
    const r = sumConverted([{ currency: 'BRL', minor: 5_000 }], 'ARS', null);
    expect(r.totalMinor).toBe(0);
    expect(r.unconverted.length).toBeGreaterThan(0);
  });

  it('conserva el signo de los negativos', () => {
    const r = sumConverted([{ currency: 'ARS', minor: -3_000 }], 'ARS', null);
    expect(r.totalMinor).toBe(-3_000);
  });
});
