import { resolveSkin } from '@/src/skins/resolveSkin';
import { DEFAULT_SKIN } from '@/src/skins/default';
import { esSkinId, FALLBACK_SKIN } from '@/src/skins/registry';
import type { SkinDefinition } from '@/src/skins/types';

describe('resolveSkin', () => {
  it('el skin default devuelve el default completo', () => {
    expect(resolveSkin('default', 'light')).toEqual(DEFAULT_SKIN.light);
    expect(resolveSkin('default', 'dark')).toEqual(DEFAULT_SKIN.dark);
  });

  it('un id inexistente cae al fallback completo', () => {
    expect(resolveSkin('no-existe', 'light')).toEqual(resolveSkin(FALLBACK_SKIN, 'light'));
  });

  it('aero pisa solo lo que declara; lo demás viene del fallback', () => {
    const aero = resolveSkin('aero', 'light');
    expect(aero.flags.soft).toBe(true);
    expect(aero.colors.bg).not.toBe(DEFAULT_SKIN.light.colors.bg);
    // No declarado por aero → heredado del default.
    expect(aero.colors.brand).toEqual(DEFAULT_SKIN.light.colors.brand);
    expect(aero.colors.semantic).toEqual(DEFAULT_SKIN.light.colors.semantic);
  });

  const skins: Record<string, SkinDefinition> = {
    default: DEFAULT_SKIN,
    roto: {
      light: {
        colors: { bg: '', text: 42 as unknown as string, marmolOpacity: Number.NaN },
        radius: { panel: 'grande' as unknown as number },
        flags: { soft: 'si' as unknown as boolean },
      },
      dark: {},
    },
  };

  it('un valor de tipo inválido o vacío queda con el del fallback', () => {
    const r = resolveSkin('roto', 'light', { skins, fallback: 'default' });
    expect(r).toEqual(DEFAULT_SKIN.light);
  });

  it('un esquema sin override devuelve el fallback de ese esquema', () => {
    expect(resolveSkin('roto', 'dark', { skins, fallback: 'default' })).toEqual(DEFAULT_SKIN.dark);
  });

  it('ignora claves que el skin base no tiene', () => {
    const extra: Record<string, SkinDefinition> = {
      default: DEFAULT_SKIN,
      x: { light: { colors: { inventado: '#fff' } as never }, dark: {} },
    };
    const r = resolveSkin('x', 'light', { skins: extra, fallback: 'default' });
    expect('inventado' in r.colors).toBe(false);
  });

  it('se puede cambiar el fallback: un skin parcial como fallback se completa con el default', () => {
    const r = resolveSkin('no-existe', 'light', { fallback: 'aero' });
    expect(r).toEqual(resolveSkin('aero', 'light'));
  });

  it('no muta el default', () => {
    const antes = JSON.stringify(DEFAULT_SKIN);
    const r = resolveSkin('aero', 'light');
    r.colors.bg = '#000000';
    r.colors.brand.primary = '#000000';
    expect(JSON.stringify(DEFAULT_SKIN)).toBe(antes);
  });
});

describe('esSkinId', () => {
  it('acepta los ids registrados y rechaza lo demás', () => {
    expect(esSkinId('default')).toBe(true);
    expect(esSkinId('aero')).toBe(true);
    expect(esSkinId('otro')).toBe(false);
    expect(esSkinId(undefined)).toBe(false);
    expect(esSkinId(3)).toBe(false);
  });
});
