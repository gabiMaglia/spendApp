import { limitarMovimientos, MAX_MOVIMIENTOS_PERSONAL } from '../limitarMovimientos';

const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

describe('limitarMovimientos (T-277)', () => {
  it('el tope es 6', () => expect(MAX_MOVIMIENTOS_PERSONAL).toBe(6));

  it.each([0, 1, 6])('con %s movimientos no recorta ni ofrece «Ver todos»', n => {
    const r = limitarMovimientos(lista(n));
    expect(r.visibles).toHaveLength(n);
    expect(r.hayMas).toBe(false);
  });

  it('con 7 muestra los 6 primeros (mismo orden) y avisa que hay más', () => {
    const r = limitarMovimientos(lista(7));
    expect(r.visibles.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
    expect(r.hayMas).toBe(true);
    expect(r.total).toBe(7);
  });
});
