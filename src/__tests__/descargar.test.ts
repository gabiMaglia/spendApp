import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { APP_STORE_ID } from '@/src/constants/web';

/**
 * T-242 · `docs/web/descargar.html`: la landing de descarga.
 *
 * Qué protege: a dónde lleva cada botón (App Store con el id REAL; el APK como asset estable
 * del último release), que la CSP coincida con el script y el estilo inline, que los tres
 * idiomas tengan las mismas claves, y qué muestra cada plataforma. El diseño (colores,
 * tamaños) no se testea.
 */
const WEB = join(__dirname, '..', '..', 'docs', 'web');
const HTML = readFileSync(join(WEB, 'descargar.html'), 'utf8');

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const UA_ESCRITORIO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function abrir(userAgent: string, language = 'es-AR') {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
      Object.defineProperty(window.navigator, 'language', { value: language, configurable: true });
    },
  });
  return dom.window.document;
}

describe('docs/web/descargar.html — enlaces', () => {
  it('iOS lleva al App Store con el id real de la app (los dos botones)', () => {
    const d = abrir(UA_ESCRITORIO);
    for (const id of ['b-ios', 'b-ios-2']) expect(d.getElementById(id)!.getAttribute('href')).toBe(`https://apps.apple.com/app/id${APP_STORE_ID}`);
    expect(APP_STORE_ID).toBe('6813102685');
  });

  it('el Smart App Banner usa el mismo id', () => {
    expect(HTML).toContain(`<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}">`);
  });

  it('Android descarga el APK del ÚLTIMO release (el link no cambia al subir uno nuevo)', () => {
    const d = abrir(UA_ESCRITORIO);
    for (const id of ['b-android', 'b-android-2']) {
      const a = d.getElementById(id)!;
      expect(a.getAttribute('href')).toBe('https://github.com/hushsplit/hushsplit.github.io/releases/latest/download/HushSplit.apk');
      expect(a.hasAttribute('download')).toBe(true);
    }
  });
});

describe('docs/web/descargar.html — seguridad de la página', () => {
  it('tiene CSP y los hashes coinciden con el script y el estilo inline', () => {
    const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
    const script = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
    const estilo = /<style>([\s\S]*?)<\/style>/.exec(HTML)![1];
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(HTML)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${hash(script)}`);
    expect(csp).toContain(`style-src ${hash(estilo)}`);
    for (const d of ["img-src 'self'", "font-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(csp).toContain(d);
    expect(HTML.indexOf('Content-Security-Policy')).toBeLessThan(HTML.indexOf('<style>'));
    expect(HTML.match(/<script>/g)).toHaveLength(1);
    expect(HTML.match(/<style>/g)).toHaveLength(1);
    expect(HTML).not.toMatch(/\sstyle="/);
    expect(HTML).not.toMatch(/\son[a-z]+="/);
  });

  it('no hace pedidos externos al cargar (sin fuentes, sin analítica)', () => {
    expect(HTML).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
    expect(HTML).not.toMatch(/googleapis|gstatic|analytics/i);
  });
});

describe('docs/web/descargar.html — idiomas', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
  const bloque = (lang: string) => {
    const ini = script.indexOf(`    ${lang}: {`);
    const fin = script.indexOf('\n    }', ini);
    return script.slice(ini, fin);
  };
  const claves = (lang: string) => [...bloque(lang).matchAll(/\b(\w+):\s*'/g)].map((m) => m[1]).sort();

  it('es, en y pt tienen exactamente las mismas claves', () => {
    expect(claves('es').length).toBeGreaterThanOrEqual(30);
    expect(claves('en')).toEqual(claves('es'));
    expect(claves('pt')).toEqual(claves('es'));
  });

  it('cada data-i y data-alt del HTML existe en los tres idiomas', () => {
    const usadas = [...HTML.matchAll(/data-(?:i|alt|aria)="(\w+)"/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(20);
    for (const k of new Set(usadas)) expect(claves('es')).toContain(k);
  });

  it.each([
    ['es-AR', 'es', 'Cuentas claras con tus compañeros de casa.'],
    ['en-US', 'en', 'Clear accounts with your housemates.'],
    ['pt-BR', 'pt', 'Contas claras com quem divide a casa.'],
    ['fr-FR', 'es', 'Cuentas claras con tus compañeros de casa.'],
  ])('idioma del navegador %s → %s', (language, lang, titulo) => {
    const d = abrir(UA_ESCRITORIO, language);
    expect(d.documentElement.lang).toBe(lang);
    expect(d.querySelector('h1')!.textContent).toBe(titulo);
    expect(d.getElementById('l-privacidad')!.getAttribute('href')).toBe(`privacidad.${lang}.html`);
  });

  it('el selector de idioma cambia el texto y marca el botón activo', () => {
    const d = abrir(UA_ESCRITORIO, 'es-AR');
    (d.querySelector('[data-lang="en"]') as HTMLElement).click();
    expect(d.querySelector('h1')!.textContent).toBe('Clear accounts with your housemates.');
    expect(d.querySelector('[data-lang="en"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(d.querySelector('[data-lang="es"]')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('docs/web/descargar.html — por plataforma', () => {
  it('en iPhone: sólo la tienda de Apple; sin instrucciones de APK', () => {
    const d = abrir(UA_IPHONE);
    expect(d.getElementById('b-android')!.className).toContain('sec');
    expect(d.getElementById('b-android-2')!.className).toContain('sec');
    expect(d.getElementById('b-ios')!.className).not.toContain('sec');
    expect(d.getElementById('como')!.hasAttribute('hidden')).toBe(true);
    expect(d.getElementById('nota-android')!.hasAttribute('hidden')).toBe(true);
  });

  it('en Android: el botón del APK va primero y se muestra cómo instalarlo', () => {
    const d = abrir(UA_ANDROID);
    expect([...d.querySelectorAll('#descarga .botones > a')].map((a) => a.id)).toEqual(['b-android', 'b-ios']);
    expect([...d.querySelectorAll('.bajar .botones > a')].map((a) => a.id)).toEqual(['b-android-2', 'b-ios-2']);
    expect(d.getElementById('b-ios')!.className).toContain('sec');
    expect(d.getElementById('b-ios-2')!.className).toContain('sec');
    expect(d.getElementById('como')!.hasAttribute('hidden')).toBe(false);
  });

  it('en escritorio: los dos botones, con el mismo peso', () => {
    const d = abrir(UA_ESCRITORIO);
    expect([...d.querySelectorAll('#descarga .botones > a')].map((a) => a.id)).toEqual(['b-ios', 'b-android']);
    expect(d.getElementById('b-ios')!.className).not.toContain('sec');
    expect(d.getElementById('b-android')!.className).not.toContain('sec');
  });
});

describe('docs/web/descargar.html — recursos', () => {
  it('todas las imágenes y páginas legales que enlaza existen', () => {
    const imgs = [...HTML.matchAll(/(?:src|href)="(img\/[^"]+)"/g)].map((m) => m[1]);
    expect(imgs.length).toBeGreaterThanOrEqual(4);
    for (const i of imgs) expect(existsSync(join(WEB, i))).toBe(true);
    // Lo que el CSS trae como fondo (patrón, guarda) también tiene que existir.
    const fondos = [...HTML.matchAll(/url\("(img\/[^"]+)"\)/g)].map((m) => m[1]);
    expect(fondos.length).toBeGreaterThanOrEqual(2);
    for (const f of fondos) expect(existsSync(join(WEB, f))).toBe(true);
    // La fuente se sirve desde el sitio (sin pedidos externos) y viaja con su licencia OFL.
    for (const f of [...HTML.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map((m) => m[1])) expect(existsSync(join(WEB, f))).toBe(true);
    expect(existsSync(join(WEB, 'fonts', 'OFL.txt'))).toBe(true);
    for (const lang of ['es', 'en', 'pt']) {
      for (const p of ['privacidad', 'terminos', 'borrar-cuenta']) expect(existsSync(join(WEB, `${p}.${lang}.html`))).toBe(true);
    }
  });

  it('las imágenes con alt traducible tienen alt de arranque (sin JS)', () => {
    for (const m of HTML.matchAll(/<img[^>]*data-alt[^>]*>/g)) expect(m[0]).toMatch(/\salt="[^"]+"/);
  });
});

describe('docs/web/descargar.html — el contexto del título', () => {
  it('sin tocar nada arranca en «casa», con su mosaico visible', () => {
    const d = abrir(UA_ESCRITORIO);
    expect(d.getElementById('contexto')!.textContent).toBe('con tus compañeros de casa.');
    expect(d.querySelector('[data-mosaico="casa"]')!.className).toBe('activo');
    expect(d.querySelector('[data-ctx="casa"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('al elegir otro contexto cambian el texto, el mosaico y el botón marcado', () => {
    const d = abrir(UA_ESCRITORIO);
    (d.querySelector('[data-ctx="asado"]') as HTMLElement).click();
    expect(d.querySelector('h1')!.textContent).toBe('Cuentas claras en cada asado.');
    expect(d.querySelector('[data-mosaico="asado"]')!.className).toBe('activo');
    expect(d.querySelector('[data-mosaico="casa"]')!.className).toBe('');
    expect(d.querySelector('[data-ctx="asado"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(d.querySelector('[data-ctx="casa"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('el contexto elegido sobrevive al cambio de idioma', () => {
    const d = abrir(UA_ESCRITORIO);
    (d.querySelector('[data-ctx="viaje"]') as HTMLElement).click();
    (d.querySelector('[data-lang="pt"]') as HTMLElement).click();
    expect(d.querySelector('h1')!.textContent).toBe('Contas claras em cada viagem.');
    expect(d.querySelector('[data-ctx="viaje"]')!.getAttribute('aria-label')).toBe('Viagem');
  });

  it('hay un mosaico por cada contexto', () => {
    const d = abrir(UA_ESCRITORIO);
    const ctx = [...d.querySelectorAll('[data-ctx]')].map((b) => b.getAttribute('data-ctx'));
    const mos = [...d.querySelectorAll('[data-mosaico]')].map((i) => i.getAttribute('data-mosaico'));
    expect(ctx).toEqual(['casa', 'viaje', 'pareja', 'asado']);
    expect(mos).toEqual(ctx);
  });
});
