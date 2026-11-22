export type BordeFundido = 'abajo' | 'derecha' | 'izquierda';

const ANGULO: Record<BordeFundido, number> = { abajo: 180, derecha: 90, izquierda: 270 };
/** Cortes con curva ease-in: arranca casi imperceptible y se asienta en el color pleno. */
const CORTES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

function aRgba(color: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(ch => ch + ch).join('') : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim());
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  return null;
}

const redondear = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Degradé continuo para el borde de una lista con scroll (PO 2026-11-22: las franjas
 * escalonadas se veían línea por línea). Va del mismo color sin alfa —nunca
 * `transparent`, que interpola desde negro y ensucia— al color pleno, con curva suave.
 */
export function degradeFundido(color: string, borde: BordeFundido): string {
  const c = aRgba(color);
  if (!c) return `linear-gradient(${ANGULO[borde]}deg, ${color}, ${color})`;
  const [r, g, b, a] = c;
  const cortes = CORTES.map(t => `rgba(${r},${g},${b},${redondear(a * t * t)}) ${Math.round(t * 100)}%`);
  return `linear-gradient(${ANGULO[borde]}deg, ${cortes.join(', ')})`;
}
