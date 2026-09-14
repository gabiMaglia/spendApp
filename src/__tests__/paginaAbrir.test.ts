import { readFileSync } from 'fs';
import { join } from 'path';
import { ENLACE_BASE, RUTAS_ENLAZABLES, TIPOS_COMPACTOS } from '@/src/utils/appLink';
import * as vm from 'vm';
import { APP_STORE_ID, BASE_URL, LINKS_URL } from '@/src/constants/web';

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

/**
 * Ejecuta el script real de la página con un `window`/`document`/`navigator` mínimos.
 * No hay navegador en Jest: esto alcanza para ver QUÉ hace la página por plataforma
 * (a dónde manda, qué muestra), que es lo que protege el secreto del link (T-097).
 */
function ejecutarPagina(opts: { userAgent: string; hash: string; maxTouchPoints?: number; language?: string }) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
  const elementos: Record<string, { textContent: string; href: string; hidden: boolean }> = {};
  const el = (id: string) => (elementos[id] ??= { textContent: '', href: '', hidden: true });
  const metas: Record<string, string>[] = [];
  const replace = jest.fn();
  const location = { hash: opts.hash, href: `https://spendapp.github.io/${opts.hash}`, replace };
  const document = {
    documentElement: { lang: 'es' },
    title: '',
    getElementById: el,
    createElement: () => {
      const attrs: Record<string, string> = {};
      return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; } };
    },
    head: { appendChild: (nodo: { attrs: Record<string, string> }) => { metas.push(nodo.attrs); } },
  };
  vm.runInNewContext(script, {
    window: { location },
    document,
    navigator: { userAgent: opts.userAgent, language: opts.language ?? 'es', maxTouchPoints: opts.maxTouchPoints ?? 0 },
  });
  return { elementos, metas, replace, location };
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('docs/web/abrir.html en iOS (T-097 · SEC M-4)', () => {
  it.each([
    ['iPhone', UA_IPHONE, 0],
    ['iPadOS (Macintosh con touch)', UA_IPADOS, 5],
  ])('%s: nunca manda el link por spendapp://', (_n, userAgent, maxTouchPoints) => {
    const { elementos, replace } = ejecutarPagina({ userAgent, maxTouchPoints, hash: '#cABC_-' });
    expect(replace).not.toHaveBeenCalled();
    for (const e of Object.values(elementos)) expect(e.href).not.toMatch(/^spendapp:/i);
  });

  it('iPhone: pone el Smart App Banner con la URL completa, fragmento incluido', () => {
    const { metas, location } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-' });
    expect(metas).toEqual([
      { name: 'apple-itunes-app', content: `app-id=${APP_STORE_ID}, app-argument=${location.href}` },
    ]);
    expect(location.href).toContain('#cABC_-');
  });

  it('iPhone: el botón lleva a la App Store y la nota explica cómo abrirla', () => {
    const { elementos } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-' });
    expect(elementos.abrir.href).toBe(`https://apps.apple.com/app/id${APP_STORE_ID}`);
    expect(elementos.abrir.textContent).toBe('Descargar spendApp');
    expect(elementos.nota.textContent).toBe('Si no se abre sola: mantené apretado el link y elegí "Abrir en spendApp", o abrilo desde Safari.');
    expect(elementos.valido.hidden).toBe(false);
  });

  it.each([
    ['en', 'Get spendApp', 'If it doesn\'t open by itself: press and hold the link and choose "Open in spendApp", or open it in Safari.'],
    ['pt', 'Baixar spendApp', 'Se não abrir sozinho: mantenha o link pressionado e escolha "Abrir no spendApp", ou abra no Safari.'],
  ])('iPhone en %s: textos traducidos', (language, boton, nota) => {
    const { elementos } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-', language });
    expect(elementos.abrir.textContent).toBe(boton);
    expect(elementos.nota.textContent).toBe(nota);
  });

  it('Android sigue abriendo con intent:// atado al paquete', () => {
    const { elementos, replace, metas } = ejecutarPagina({ userAgent: UA_ANDROID, hash: '#cABC_-' });
    const esperado = 'intent://contact/add?c=ABC_-#Intent;scheme=spendapp;package=com.splitp2p.app;end';
    expect(elementos.abrir.href).toBe(esperado);
    expect(replace).toHaveBeenCalledWith(esperado);
    expect(metas).toEqual([]);
  });

  it('en iOS un link inválido sigue mostrando «incompleto», sin banner', () => {
    const { elementos, metas, replace } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#settle/new?x=1' });
    expect(elementos.invalido.hidden).toBe(false);
    expect(metas).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
  });

  it('el id de la App Store de la página es el de constants/web', () => {
    expect(HTML).toContain(`var APP_STORE_ID = '${APP_STORE_ID}'`);
  });
});
