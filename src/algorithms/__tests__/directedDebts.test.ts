import type { CurrencyCode } from '@/src/constants/currencies';
import { directedDebts, netOf, totalIOwe, totalOwedToMe } from '../directedDebts';

const tx = (from: string, to: string, amount: number, currency: CurrencyCode = 'ARS') =>
  ({ fromUserId: from, toUserId: to, amount, currency });

describe('directedDebts', () => {
  it('lo que me deben y lo que debo NO se cancelan entre si (ADR-006)', () => {
    // El bug del PO: en un grupo le debia 5.000 y en otro le debian 5.000, y
    // el modelo decia "cero". Son dos hechos distintos, no dos signos de un
    // mismo numero: que yo salde lo mio no cancela lo que me deben.
    const r = directedDebts([tx('yo', 'beto', 5_000), tx('beto', 'yo', 5_000)], 'yo');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ userId: 'beto', iOwe: 5_000, owesMe: 5_000 });
  });

  it('suma lo que debo a la misma persona en distintos grupos', () => {
    const r = directedDebts([tx('yo', 'beto', 3_000), tx('yo', 'beto', 2_000)], 'yo');
    expect(r[0]).toMatchObject({ iOwe: 5_000, owesMe: 0 });
  });

  it('separa por moneda: no se mezclan', () => {
    const r = directedDebts([tx('yo', 'beto', 1_000), tx('yo', 'beto', 500, 'BRL')], 'yo');
    expect(r).toHaveLength(2);
    expect(r.find(d => d.currency === 'BRL')).toMatchObject({ iOwe: 500 });
  });

  it('separa por persona', () => {
    const r = directedDebts([tx('yo', 'beto', 1_000), tx('caro', 'yo', 700)], 'yo');
    expect(r.find(d => d.userId === 'beto')).toMatchObject({ iOwe: 1_000, owesMe: 0 });
    expect(r.find(d => d.userId === 'caro')).toMatchObject({ iOwe: 0, owesMe: 700 });
  });

  it('ignora las transacciones donde no participo', () => {
    expect(directedDebts([tx('beto', 'caro', 1_000)], 'yo')).toEqual([]);
  });

  it('sin transacciones no devuelve nada', () => {
    expect(directedDebts([], 'yo')).toEqual([]);
  });
});

describe('lecturas derivadas', () => {
  const deudas = directedDebts(
    [tx('yo', 'beto', 5_000), tx('beto', 'yo', 5_000), tx('yo', 'caro', 1_000)],
    'yo',
  );

  it('el neto sigue disponible para quien lo necesite', () => {
    // No desaparece: deja de ser la DEFINICION de la deuda, pero sirve para
    // resumir de un vistazo si estas a favor o en contra.
    expect(netOf(deudas.find(d => d.userId === 'beto')!)).toBe(0);
    expect(netOf(deudas.find(d => d.userId === 'caro')!)).toBe(-1_000);
  });

  it('cuanto debo en total, por moneda', () => {
    expect(totalIOwe(deudas, 'ARS')).toBe(6_000);
  });

  it('cuanto me deben en total, por moneda', () => {
    expect(totalOwedToMe(deudas, 'ARS')).toBe(5_000);
  });

  it('los totales NO se compensan: 6.000 y 5.000, no 1.000', () => {
    // Es lo que alimenta el indicador nuevo de Personal.
    expect(totalIOwe(deudas, 'ARS') - totalOwedToMe(deudas, 'ARS')).toBe(1_000);
    expect(totalIOwe(deudas, 'ARS')).not.toBe(1_000);
  });
});
