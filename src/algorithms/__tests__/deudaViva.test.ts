import { deudasDe, monedasConDeuda, tieneDeudaViva } from '@/src/algorithms/deudaViva';
import type { DeudaPar } from '@/src/algorithms/deudasDelGrupo';

const d = (deudor: string, acreedor: string, monto: number, currency: 'ARS' | 'USD' = 'ARS'): DeudaPar =>
  ({ deudor, acreedor, currency, monto });

describe('tieneDeudaViva (T-228: cualquier deuda, en cualquier dirección, bloquea)', () => {
  it('sin deudas: false', () => expect(tieneDeudaViva([], 'a')).toBe(false));
  it('debo: true', () => expect(tieneDeudaViva([d('a', 'b', 100)], 'a')).toBe(true));
  it('me deben: true', () => expect(tieneDeudaViva([d('b', 'a', 100)], 'a')).toBe(true));
  it('deuda entre otros dos: false', () => expect(tieneDeudaViva([d('b', 'c', 100)], 'a')).toBe(false));
  it('cruzadas con neto 0: true', () => expect(tieneDeudaViva([d('a', 'b', 60), d('b', 'a', 60)], 'a')).toBe(true));
});

describe('deudasDe', () => {
  it('sólo las mías, en las dos direcciones', () => {
    const todas = [d('a', 'b', 1), d('b', 'c', 2), d('c', 'a', 3)];
    expect(deudasDe(todas, 'a')).toEqual([d('a', 'b', 1), d('c', 'a', 3)]);
  });
});

describe('monedasConDeuda', () => {
  it('cada moneda una vez, en orden de aparición', () => {
    expect(monedasConDeuda([d('a', 'b', 1, 'USD'), d('c', 'a', 1), d('a', 'd', 1, 'USD')], 'a'))
      .toEqual(['USD', 'ARS']);
  });
});
