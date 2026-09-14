import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { APP_STORE_ID, APPLE_TEAM_ID, BASE_URL } from '@/src/constants/web';
import { RUTAS_ENLAZABLES, TIPOS_COMPACTOS } from '@/src/utils/appLink';

/**
 * **Universal Links (T-097 · SEC M-4).**
 *
 * Tres archivos tienen que decir lo mismo y ninguno lo sabe del otro: `app.json` (el
 * dominio asociado), el AASA publicado en el sitio (qué app y qué fragmentos) y las
 * constantes de `web.ts`. Si se desincronizan, iOS no abre la app y el link cae a la
 * página: no rompe nada visible, así que sólo un test lo detecta.
 */
const RAIZ = join(__dirname, '..', '..');
const APP = JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')).expo;
const RUTA_AASA = join(RAIZ, 'docs', 'web', '.well-known', 'apple-app-site-association');

type Componente = { '/': string; '#': string; comment?: string };
type Aasa = { applinks: { details: { appIDs: string[]; components: Componente[] }[] } };

const aasa = (): Aasa => JSON.parse(readFileSync(RUTA_AASA, 'utf8'));

describe('Universal Links (T-097)', () => {
  it('los valores de Apple son los del PO', () => {
    expect(APPLE_TEAM_ID).toBe('4GP6785MU4');
    expect(APP_STORE_ID).toBe('6801922014');
  });

  it('app.json declara el dominio del sitio como dominio asociado', () => {
    const host = new URL(BASE_URL).host;
    expect(APP.ios.associatedDomains).toEqual([`applinks:${host}`]);
  });

  it('el AASA existe y es JSON válido', () => {
    expect(existsSync(RUTA_AASA)).toBe(true);
    expect(() => aasa()).not.toThrow();
  });

  it('el AASA habilita exactamente esta app: <TEAM>.<bundle>', () => {
    const details = aasa().applinks.details;
    expect(details).toHaveLength(1);
    expect(details[0].appIDs).toEqual([`${APPLE_TEAM_ID}.${APP.ios.bundleIdentifier}`]);
  });

  it('los fragmentos del AASA son exactamente los enlazables de la app, ni uno más', () => {
    const esperados = [
      ...Object.keys(TIPOS_COMPACTOS).map((letra) => `${letra}*`),
      ...RUTAS_ENLAZABLES.map((ruta) => `${ruta}*`),
    ].sort();
    const reales = aasa().applinks.details[0].components.map((c) => c['#']).sort();
    expect(reales).toEqual(esperados);
  });

  it('ningún componente abre la raíz sin fragmento ni otra ruta del sitio', () => {
    for (const c of aasa().applinks.details[0].components) {
      expect(c['/']).toBe('/');
      expect(typeof c['#']).toBe('string');
      expect(c['#'].length).toBeGreaterThan(1);
    }
  });
});
