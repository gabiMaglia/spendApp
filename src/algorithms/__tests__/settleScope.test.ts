import { topeDelSaldo, excedeElTope } from '../settleScope';

describe('topeDelSaldo', () => {
  it('sin tope externo, el techo es la deuda del grupo', () => {
    expect(topeDelSaldo(5_000, undefined)).toBe(5_000);
  });

  it('el tope externo NUNCA puede subir el techo del grupo', () => {
    // Este es el bug: Contactos mandaba el neto global (10.000) y todo eso
    // podia volcarse en un grupo donde solo se debian 3.000.
    expect(topeDelSaldo(3_000, 10_000)).toBe(3_000);
  });

  it('si el tope externo es MENOR, manda el externo', () => {
    expect(topeDelSaldo(5_000, 2_000)).toBe(2_000);
  });

  it('sin deuda en este grupo el techo es 0, venga lo que venga de afuera', () => {
    expect(topeDelSaldo(0, 10_000)).toBe(0);
  });

  it('una deuda negativa (me deben) tampoco habilita saldar', () => {
    // Saldar es direccional: que me deban no me habilita a "saldar" nada.
    expect(topeDelSaldo(-5_000, 10_000)).toBe(0);
  });
});

describe('excedeElTope', () => {
  it('el monto exacto NO excede', () => {
    expect(excedeElTope(3_000, 3_000)).toBe(false);
  });

  it('un peso de mas excede', () => {
    expect(excedeElTope(3_001, 3_000)).toBe(true);
  });

  it('con techo 0 cualquier monto excede', () => {
    expect(excedeElTope(1, 0)).toBe(true);
  });
});
