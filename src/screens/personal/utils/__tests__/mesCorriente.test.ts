import { esDelMesCorriente } from '../mesCorriente';

const ahora = new Date(2026, 10, 15, 12);

describe('esDelMesCorriente', () => {
  it('una fecha de este mes es del mes corriente', () => {
    expect(esDelMesCorriente(new Date(2026, 10, 3).getTime(), ahora)).toBe(true);
  });

  it('el primer y el último instante del mes cuentan', () => {
    expect(esDelMesCorriente(new Date(2026, 10, 1, 0, 0, 0).getTime(), ahora)).toBe(true);
    expect(esDelMesCorriente(new Date(2026, 10, 30, 23, 59, 59).getTime(), ahora)).toBe(true);
  });

  it('el mes anterior no', () => {
    expect(esDelMesCorriente(new Date(2026, 9, 31, 23, 59).getTime(), ahora)).toBe(false);
  });

  it('el mismo mes de otro año no', () => {
    expect(esDelMesCorriente(new Date(2025, 10, 15).getTime(), ahora)).toBe(false);
  });
});
