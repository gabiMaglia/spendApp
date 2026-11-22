import { degradeFundido } from '@/src/components/menu/degradeFundido';

describe('degradeFundido (PO 2026-11-22: continuo, sin franjas)', () => {
  it('es un solo linear-gradient continuo, del color sin alfa al color pleno', () => {
    const g = degradeFundido('rgba(12, 16, 14, 0.7)', 'abajo');
    expect(g.startsWith('linear-gradient(180deg,')).toBe(true);
    expect(g).toContain('rgba(12,16,14,0) 0%');
    expect(g).toContain('rgba(12,16,14,0.7) 100%');
  });

  it('usa varios cortes con curva suave (no un salto lineal de dos puntos)', () => {
    const cortes = degradeFundido('rgba(12,16,14,0.7)', 'abajo').match(/rgba\([^)]*\) \d+%/g) ?? [];
    expect(cortes.length).toBeGreaterThanOrEqual(6);
    const alfas = cortes.map(c => Number(/,([\d.]+)\)/.exec(c)![1]));
    alfas.slice(1).forEach((a, i) => expect(a).toBeGreaterThanOrEqual(alfas[i]));
  });

  it('el ángulo sigue al borde: derecha 90deg, izquierda 270deg', () => {
    expect(degradeFundido('rgba(0,0,0,0.5)', 'derecha').startsWith('linear-gradient(90deg,')).toBe(true);
    expect(degradeFundido('rgba(0,0,0,0.5)', 'izquierda').startsWith('linear-gradient(270deg,')).toBe(true);
  });

  it('acepta hex (alfa 1) y no usa `transparent` (evita el gris del negro transparente)', () => {
    const g = degradeFundido('#0c100e', 'abajo');
    expect(g).toContain('rgba(12,16,14,0) 0%');
    expect(g).toContain('rgba(12,16,14,1) 100%');
    expect(g).not.toContain('transparent');
  });
});
