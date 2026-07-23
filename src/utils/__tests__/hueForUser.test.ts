import { hueForUser } from '../hueForUser';

describe('hueForUser', () => {
  it('siempre devuelve un entero en el rango 0–6', () => {
    const ids = ['', 'a', 'u1', 'userA', 'b3f1c2d4-1111-2222-3333-444455556666', '日本語', '🚀'];
    for (const id of ids) {
      const h = hueForUser(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(6);
    }
  });

  it('es determinista: el mismo id devuelve siempre el mismo hue', () => {
    expect(hueForUser('userA')).toBe(hueForUser('userA'));
    expect(hueForUser('b3f1c2d4-1111')).toBe(hueForUser('b3f1c2d4-1111'));
  });

  it('distribuye distintos ids en varios hues (no todos iguales)', () => {
    const hues = new Set(Array.from({ length: 30 }, (_, i) => hueForUser(`user-${i}`)));
    expect(hues.size).toBeGreaterThan(1);
  });
});
