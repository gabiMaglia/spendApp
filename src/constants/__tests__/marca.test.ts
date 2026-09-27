import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';
import { BACKUP_FORMAT } from '@/src/services/backup';

/**
 * La marca es «HushSplit» (2026-09-27). «spendApp» estaba ocupado en las tiendas y
 * «SplitP2P» describía un P2P que la app no hace desde T-083: el sync va por el buzón.
 *
 * Lo que CAMBIA es lo que la gente ve: el nombre bajo el ícono, los textos, las páginas
 * públicas y los nombres de archivo que exporta. Lo que NO cambia es lo que otras cosas
 * tienen atado: el slug (proyecto de EAS), el esquema y el dominio (links ya
 * compartidos), los ids de bundle/package (registros en las tiendas, OAuth, AASA), las
 * etiquetas de derivación de claves y el tag interno del formato de backup (romperían
 * invites y backups ya existentes). Este test sostiene las dos mitades.
 */
const RAIZ = join(__dirname, '..', '..', '..');
const app = JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')) as {
  expo: { name: string; slug: string; scheme: string; ios: { bundleIdentifier: string }; android: { package: string } };
};

const NOMBRES_VIEJOS = /spendapp|splitp2p/i;

function hojas(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj && typeof obj === 'object') return Object.values(obj as object).flatMap(hojas);
  return [];
}

describe('marca HushSplit — lo que se ve', () => {
  it('app.json: el nombre bajo el ícono es HushSplit', () => {
    expect(app.expo.name).toBe('HushSplit');
  });

  it.each([['es', es], ['en', en], ['pt', pt]])('%s: ningún texto nombra a la app con el nombre viejo', (_l, dict) => {
    const viejos = hojas(dict).filter((s) => NOMBRES_VIEJOS.test(s));
    expect(viejos).toEqual([]);
  });

  it('las páginas públicas no nombran a la app con el nombre viejo (el dominio y el esquema quedan)', () => {
    const web = join(RAIZ, 'docs', 'web');
    const conNombreViejo = readdirSync(web)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => {
        const sinDominioEsquemaNiId = readFileSync(join(web, f), 'utf8')
          .replace(/spendapp\.github\.io/g, '')
          .replace(/scheme=spendapp|spendapp:/g, '')
          .replace(/com\.splitp2p\.app/g, '');
        return NOMBRES_VIEJOS.test(sinDominioEsquemaNiId);
      });
    expect(conNombreViejo).toEqual([]);
  });
});

describe('marca HushSplit — lo que NO se toca', () => {
  it('slug, esquema e ids de bundle/package siguen atados a lo publicado', () => {
    expect(app.expo.slug).toBe('spendApp');
    expect(app.expo.scheme).toBe('spendapp');
    expect(app.expo.ios.bundleIdentifier).toBe('com.splitp2p.app');
    expect(app.expo.android.package).toBe('com.splitp2p.app');
  });

  it('el tag interno del formato de backup no cambia: los backups viejos se siguen abriendo', () => {
    expect(BACKUP_FORMAT).toBe('splitp2p-backup');
  });
});
