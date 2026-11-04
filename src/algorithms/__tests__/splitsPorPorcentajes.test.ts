import { splitsPorPorcentajes } from '../recurringSplits';

const montos = (s: { amount: number }[]) => s.map(x => x.amount);
const suma = (s: { amount: number }[]) => s.reduce((t, x) => t + x.amount, 0);

describe('splitsPorPorcentajes (T-261): último miembro en 0%', () => {
  it('grupo de 3 al 50/50/0 con monto impar: sin negativos y suma exacta', () => {
    const s = splitsPorPorcentajes(100_001, ['a', 'b', 'c'], [50, 50]);
    expect(montos(s).every(m => m >= 0)).toBe(true);
    expect(suma(s)).toBe(100_001);
    expect(s[2].amount).toBe(0);
  });

  it('CLP 1001 al 50/50/0: el redondeo cae en alguien con % > 0', () => {
    const s = splitsPorPorcentajes(1_001, ['a', 'b', 'c'], [50, 50]);
    expect(suma(s)).toBe(1_001);
    expect(montos(s).every(m => m >= 0)).toBe(true);
    expect(s[2].amount).toBe(0);
  });

  it('también si llegan los % de todos', () => {
    const s = splitsPorPorcentajes(1_001, ['a', 'b', 'c'], [50, 50, 0]);
    expect(s[2].amount).toBe(0);
    expect(suma(s)).toBe(1_001);
  });

  it('caso normal sin cambios: el último recibe el resto', () => {
    expect(montos(splitsPorPorcentajes(1_000, ['a', 'b', 'c'], [33, 33]))).toEqual([330, 330, 340]);
  });
});
