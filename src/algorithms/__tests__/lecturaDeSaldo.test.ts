import { lecturaDeSaldo } from '@/src/algorithms/lecturaDeSaldo';

describe('lecturaDeSaldo', () => {
  it('a favor: el neto es lo que te deben menos lo que debés, con desglose', () => {
    expect(lecturaDeSaldo(224_712_61, 120_850_00)).toEqual({
      tono: 'favor', neto: 103_862_61, desglose: true,
    });
  });

  it('en contra: el neto va en positivo y el tono lo dice', () => {
    expect(lecturaDeSaldo(5_000, 12_000)).toEqual({ tono: 'contra', neto: 7_000, desglose: true });
  });

  it('sólo un lado con deuda: sin desglose (repetiría el mismo número)', () => {
    expect(lecturaDeSaldo(8_000, 0)).toEqual({ tono: 'favor', neto: 8_000, desglose: false });
    expect(lecturaDeSaldo(0, 3_000)).toEqual({ tono: 'contra', neto: 3_000, desglose: false });
  });

  it('nada en ningún lado: saldado, sin desglose', () => {
    expect(lecturaDeSaldo(0, 0)).toEqual({ tono: 'saldado', neto: 0, desglose: false });
  });

  it('los dos lados iguales: saldado en neto, pero el desglose se ve (hay deudas abiertas)', () => {
    expect(lecturaDeSaldo(4_000, 4_000)).toEqual({ tono: 'saldado', neto: 0, desglose: true });
  });

  it('valores negativos o no finitos se tratan como 0', () => {
    expect(lecturaDeSaldo(-10, Number.NaN)).toEqual({ tono: 'saldado', neto: 0, desglose: false });
  });
});
