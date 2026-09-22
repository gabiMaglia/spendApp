import { capitalizar } from '../capitalizar';

describe('capitalizar', () => {
  it('pone en mayúscula sólo la primera letra', () => {
    expect(capitalizar('gabriel')).toBe('Gabriel');
  });

  it('no toca el resto del nombre', () => {
    expect(capitalizar('mcKenzie')).toBe('McKenzie');
  });

  it('ya capitalizado, queda igual', () => {
    expect(capitalizar('Ana')).toBe('Ana');
  });

  it('cadena vacía, no rompe', () => {
    expect(capitalizar('')).toBe('');
  });
});
