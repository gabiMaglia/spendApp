import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveSkin } from '@/src/skins/resolveSkin';

/** Cuántas sombras trae un `boxShadow` (coma de nivel 0, fuera de paréntesis). */
export function contarSombras(boxShadow: string): number {
  let nivel = 0;
  let n = 1;
  for (const ch of boxShadow) {
    if (ch === '(') nivel++;
    else if (ch === ')') nivel--;
    else if (ch === ',' && nivel === 0) n++;
  }
  return n;
}

describe('T-292 profundidad del Aero', () => {
  it.each(['light', 'dark'] as const)('e2 y e3 son sombra de dos capas en %s', scheme => {
    const { elevation } = resolveSkin('aero', scheme);
    expect(contarSombras(elevation.e2.boxShadow)).toBe(2);
    expect(contarSombras(elevation.e3.boxShadow)).toBe(2);
  });

  it.each(['light', 'dark'] as const)('e1 (filas y chips) es una sola capa en %s', scheme => {
    expect(contarSombras(resolveSkin('aero', scheme).elevation.e1.boxShadow)).toBe(1);
  });

  it('Clásico queda intacto: nunca usa dos capas en e2', () => {
    expect(contarSombras(resolveSkin('default', 'light').elevation.e2.boxShadow)).toBe(1);
  });

  it.each(['ExpenseCard.tsx', 'GroupCard.tsx'].map(f => `src/components/${f}`)
    .concat('src/screens/activity/components/EventRow.tsx'))(
    'la fila %s no usa la elevación doble (e2/e3)', archivo => {
      const src = readFileSync(join(__dirname, '../../..', archivo), 'utf8');
      expect(src).not.toMatch(/elevation\.e[23]|nivel="e2"|<Panel[^>]*nivel/);
    });
});
