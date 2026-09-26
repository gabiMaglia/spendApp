import { resolveSkin } from '@/src/skins/resolveSkin';
import { DEFAULT_SKIN } from '@/src/skins/default';
import { esSkinId, FALLBACK_SKIN, SKINS } from '@/src/skins/registry';
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
    // Con `opts` el resultado es fresco (sin caché): se puede mutar sin
    // ensuciar el objeto cacheado que comparte toda la app. Mismos skins y
    // mismo fallback que el camino del registro.
    const r = resolveSkin('aero', 'light', { skins: SKINS, fallback: FALLBACK_SKIN });
    r.colors.bg = '#000000';
    r.colors.brand.primary = '#000000';
    expect(JSON.stringify(DEFAULT_SKIN)).toBe(antes);
  });
});

describe('resolveSkin: caché del registro', () => {
  it('sin opts, el mismo id y esquema devuelven el MISMO objeto', () => {
    expect(resolveSkin('aero', 'light')).toBe(resolveSkin('aero', 'light'));
    expect(resolveSkin('default', 'dark')).toBe(resolveSkin('default', 'dark'));
  });

  it('distinto id o esquema, distinto objeto', () => {
    expect(resolveSkin('aero', 'light')).not.toBe(resolveSkin('aero', 'dark'));
    expect(resolveSkin('aero', 'light')).not.toBe(resolveSkin('default', 'light'));
  });

  it('con opts no cachea: cada llamada es un objeto nuevo', () => {
    const opts = { skins: SKINS, fallback: FALLBACK_SKIN };
    const a = resolveSkin('aero', 'light', opts);
    const b = resolveSkin('aero', 'light', opts);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a).toEqual(resolveSkin('aero', 'light'));
  });

  it('el objeto cacheado está congelado: nadie lo puede mutar por accidente', () => {
    const r = resolveSkin('aero', 'light');
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.colors)).toBe(true);
    expect(Object.isFrozen(r.colors.brand)).toBe(true);
  });

  it('el cacheado tampoco comparte referencias con DEFAULT_SKIN', () => {
    const r = resolveSkin('default', 'light');
    expect(r).not.toBe(DEFAULT_SKIN.light);
    expect(r.colors).not.toBe(DEFAULT_SKIN.light.colors);
    expect(Object.isFrozen(DEFAULT_SKIN.light.colors)).toBe(false);
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
