import { readFileSync } from 'fs';
import { join } from 'path';
import { ENLACE_BASE, RUTAS_ENLAZABLES, TIPOS_COMPACTOS } from '@/src/utils/appLink';
import { BASE_URL, LINKS_URL } from '@/src/constants/web';

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
    // Los links nuevos van a la organización; la copia de `docs/web` atiende los viejos.
    expect(ENLACE_BASE).toBe(LINKS_URL);
    expect(LINKS_URL).toBe('https://spendapp.github.io/');
    // Las páginas legales viven en el mismo sitio, sin el usuario personal del PO.
    expect(BASE_URL).toBe('https://spendapp.github.io');
  });

  it('abre exactamente las mismas rutas que la app acepta', () => {
    const m = /var RUTAS = \[([^\]]*)\]/.exec(HTML);
    expect(m).not.toBeNull();
    const rutas = m![1].split(',').map(r => r.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect([...rutas].sort()).toEqual([...RUTAS_ENLAZABLES].sort());
  });

  it('traduce los mismos tipos compactos que la app', () => {
    const m = /var TIPOS = (\{[^}]*\})/.exec(HTML);
    expect(m).not.toBeNull();
    const tipos = JSON.parse(m![1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
    expect(tipos).toEqual(TIPOS_COMPACTOS);
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

  it('el script de publicación copia esta página como index, y todas las legales', () => {
    const script = readFileSync(join(__dirname, '..', '..', 'scripts', 'publicar-sitio.sh'), 'utf8');
    expect(script).toContain('spendapp/spendapp.github.io');
    expect(script).toContain('cp "$WEB/abrir.html" index.html');
    // Copia todo docs/web/*.html salvo el index viejo y abrir.html (que ya fue como index).
    expect(script).toContain('for f in "$WEB"/*.html');
    expect(script).toMatch(/index\.html\|abrir\.html\) ;;/);
  });

  it('sin link, hace de índice: enlaza las tres páginas legales en el idioma de la página', () => {
    expect(HTML).toMatch(/\['l-privacidad', 'privacidad'\]/);
    expect(HTML).toMatch(/\['l-terminos', 'terminos'\]/);
    expect(HTML).toMatch(/\['l-borrar', 'borrar-cuenta'\]/);
  });


  it('lee los datos del fragmento, no de la query que sí llega al servidor', () => {
    expect(HTML).toContain('window.location.hash');
    expect(HTML).not.toContain('location.search');
  });

  it('tiene CSP y los hashes coinciden con el script y el estilo inline (T-098 L-1)', () => {
    const { createHash } = require('crypto');
    const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
    const script = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
    const estilo = /<style>([\s\S]*?)<\/style>/.exec(HTML)![1];
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(HTML);
    expect(csp).not.toBeNull();
    const c = csp![1];
    expect(c).toContain("default-src 'none'");
    expect(c).toContain(`script-src ${hash(script)}`);
    expect(c).toContain(`style-src ${hash(estilo)}`);
    for (const d of ["img-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(c).toContain(d);
    // La CSP tiene que estar antes del primer <style>/<script> para que aplique.
    expect(HTML.indexOf('Content-Security-Policy')).toBeLessThan(HTML.indexOf('<style>'));
    expect(HTML.match(/<script>/g)).toHaveLength(1);
    expect(HTML.match(/<style>/g)).toHaveLength(1);
    expect(HTML).not.toMatch(/\sstyle="/);
  });

  it('la query del formato largo sólo pasa si cumple la whitelist (T-098 L-1)', () => {
    expect(HTML).toContain('/^[A-Za-z0-9%._~=&+-]*$/.test(query)');
  });
});
