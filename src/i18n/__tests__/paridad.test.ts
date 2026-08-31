import es from '../locales/es.json';
import en from '../locales/en.json';
import pt from '../locales/pt.json';

/**
 * Los tres idiomas tienen que tener EXACTAMENTE las mismas claves.
 *
 * La regla del proyecto es es/en/pt obligatorio y ningún string visible
 * hardcodeado. Pero olvidarse de traducir una clave **no rompe nada**: i18next
 * cae a la clave cruda, así que el usuario ve `sync.failure_title` en pantalla
 * y en los tests no pasa nada — los tests mockean `t()` para que devuelva la
 * clave, justamente.
 *
 * Español es la fuente de verdad (lo dice CLAUDE.md: se crea primero).
 */
type Nodo = { [k: string]: unknown };

function claves(obj: Nodo, prefijo = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? claves(v as Nodo, ruta)
      : [ruta];
  });
}

const enEs = claves(es as Nodo);

describe.each([['en', en], ['pt', pt]])('%s está completo contra español', (_lang, dict) => {
  const enOtro = claves(dict as Nodo);

  it('no le falta ninguna clave', () => {
    expect(enEs.filter(k => !enOtro.includes(k))).toEqual([]);
  });

  it('no tiene claves de más (una clave muerta o un typo)', () => {
    expect(enOtro.filter(k => !enEs.includes(k))).toEqual([]);
  });

  it('ningún texto quedó vacío', () => {
    const vacias = enOtro.filter(ruta => {
      const v = ruta.split('.').reduce<unknown>((o, k) => (o as Nodo)?.[k], dict);
      return typeof v === 'string' && v.trim() === '';
    });
    expect(vacias).toEqual([]);
  });
});

describe('español', () => {
  it('no tiene textos vacíos', () => {
    const vacias = enEs.filter(ruta => {
      const v = ruta.split('.').reduce<unknown>((o, k) => (o as Nodo)?.[k], es);
      return typeof v === 'string' && v.trim() === '';
    });
    expect(vacias).toEqual([]);
  });
});
