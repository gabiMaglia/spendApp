import { readFileSync } from 'fs';
import { join } from 'path';
import { ENLACE_BASE, RUTAS_ENLAZABLES } from '@/src/utils/appLink';
import { BASE_URL } from '@/src/constants/web';

/**
 * La página que abre la app desde un link (`docs/web/abrir.html`).
 *
 * No hay test de navegador para esto: lo que sí se puede fijar es lo que, si se rompe,
 * rompe en silencio — que la página exista donde apunta la app, que abra las mismas
 * pantallas que la app acepta, y que no cargue nada de afuera (el link lleva un secreto).
 */

const HTML = readFileSync(join(__dirname, '..', '..', 'docs', 'web', 'abrir.html'), 'utf8');

describe('docs/web/abrir.html', () => {
  it('la app apunta a esta página', () => {
    expect(ENLACE_BASE).toBe(`${BASE_URL}/abrir.html`);
  });

  it('abre exactamente las mismas rutas que la app acepta', () => {
    const m = /var RUTAS = \[([^\]]*)\]/.exec(HTML);
    expect(m).not.toBeNull();
    const rutas = m![1].split(',').map(r => r.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect([...rutas].sort()).toEqual([...RUTAS_ENLAZABLES].sort());
  });

  it('abre el paquete de la app en Android', () => {
    const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8'));
    expect(HTML).toContain(`var PAQUETE_ANDROID = '${app.expo.android.package}'`);
    expect(HTML).toContain(`scheme=${app.expo.scheme}`);
  });

  it('no carga NADA de afuera: los datos del link no pueden salir a un tercero', () => {
    expect(HTML).not.toMatch(/<script[^>]+src=/i);
    expect(HTML).not.toMatch(/<link[^>]+href=/i);
    expect(HTML).not.toMatch(/<img[^>]+src=["']https?:/i);
    expect(HTML).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/);
  });

  it('lee los datos del fragmento, no de la query que sí llega al servidor', () => {
    expect(HTML).toContain('window.location.hash');
    expect(HTML).not.toContain('location.search');
  });
});
