import { resolveSkin } from '@/src/skins/resolveSkin';
import { DEFAULT_SKIN } from '@/src/skins/default';
import { esSkinId, SKIN_INICIAL } from '@/src/skins/registry';

/** Contraste WCAG entre dos `#RRGGBB`. */
function contraste(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('skin Aero (afinado)', () => {
  it('es un id válido y es el skin inicial', () => {
    expect(esSkinId('aero')).toBe(true);
    expect(SKIN_INICIAL).toBe('aero');
  });

  it('pisa marca y fondos; lo que no declara viene del default', () => {
    const aero = resolveSkin('aero', 'light');
    expect(aero.flags.soft).toBe(true);
    expect(aero.colors.brand.primary).not.toBe(DEFAULT_SKIN.light.colors.brand.primary);
    expect(aero.colors.category).toEqual(DEFAULT_SKIN.light.colors.category);
    expect(aero.colors.semantic.warning).toBe(DEFAULT_SKIN.light.colors.semantic.warning);
  });

  it('no contamina a Clásico', () => {
    expect(resolveSkin('default', 'light')).toEqual(DEFAULT_SKIN.light);
    expect(resolveSkin('default', 'dark')).toEqual(DEFAULT_SKIN.dark);
  });

});

describe.each(['default', 'aero'] as const)('contraste AA del skin %s', id => {
  it.each(['light', 'dark'] as const)('textos sobre sus superficies en %s', scheme => {
    const { colors: c } = resolveSkin(id, scheme);
    for (const fondo of [c.surface, c.surfaceSunken, c.bgGrouped]) {
      expect(contraste(c.textTertiary, fondo)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(c.semantic.neutral, fondo)).toBeGreaterThanOrEqual(4.4);
    }
    expect(contraste(c.semantic.warning, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.semantic.positive, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.semantic.negative, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.textOnBrand, c.brand.primary)).toBeGreaterThanOrEqual(4.5);
  });
});
