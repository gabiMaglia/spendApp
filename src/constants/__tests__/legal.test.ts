import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import {
  BASE_URL, LEGAL_DISPONIBLE, idiomaDeLaPagina,
  urlDeBorrado, urlDePrivacidad, urlDeTerminos,
} from '../legal';

/**
 * T-090 · Las tres páginas públicas.
 *
 * La de borrado **es un requisito de Google Play**: sin una URL viva declarada
 * en el Data Safety, una app con cuentas no puede publicar actualizaciones. Y
 * el modo de falla no es un error visible, es un link que abre la nada — que es
 * exactamente lo que ya pasó con `src/constants/tienda.ts` (un id de relleno,
 * y encima abriendo el App Store en Android).
 *
 * ⚠️ El barrido de más abajo **saltea `__tests__`**: este archivo nombra las
 * tres funciones y sin la exclusión se detectaría a sí mismo. Ya pasó tres veces
 * en este proyecto.
 */
const RAIZ = join(__dirname, '..', '..', '..');
const WEB = join(RAIZ, 'docs', 'web');

/**
 * Las páginas que PUEDEN tener un script inline. Sólo `abrir.html`: abre la app desde un
 * link, y los datos del link vienen en el fragmento (`#…`), que únicamente se lee con
 * JavaScript. La prohibición de fondo sigue intacta — nada de terceros y ningún pedido
 * de red —, y cualquier otra página sigue sin poder tener `<script>`.
 */
const CON_SCRIPT_INLINE = ['abrir.html'];
const IDIOMAS = ['es', 'en', 'pt'] as const;
const PAGINAS = ['borrar-cuenta', 'privacidad', 'terminos'] as const;

describe('las URLs', () => {
  it('son https y no llevan un valor de relleno', () => {
    for (const url of [urlDeBorrado('es'), urlDePrivacidad('es'), urlDeTerminos('es')]) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url).not.toMatch(/pendiente|example\.com|localhost|000000000|TODO/i);
    }
  });

  it('no muestran el usuario personal del PO: van a la ficha de la tienda (2026-09-12)', () => {
    for (const l of ['es', 'en', 'pt']) {
      for (const url of [urlDeBorrado(l), urlDePrivacidad(l), urlDeTerminos(l)]) {
        expect(url.startsWith('https://spendapp.github.io/')).toBe(true);
        expect(url).not.toContain('gabimaglia');
      }
    }
  });

  it('apuntan a un archivo que existe de verdad', () => {
    // Es lo que separa «la constante está escrita» de «el link abre algo».
    for (const url of [urlDeBorrado('es'), urlDePrivacidad('en'), urlDeTerminos('pt')]) {
      const archivo = url.slice(BASE_URL.length + 1);
      expect(existsSync(join(WEB, archivo))).toBe(true);
    }
  });

  it('caen a español ante un idioma que no publicamos', () => {
    expect(idiomaDeLaPagina('fr')).toBe('es');
    expect(idiomaDeLaPagina(undefined)).toMatch(/^(es|en|pt)$/);
    expect(idiomaDeLaPagina('pt-BR')).toBe('pt');   // la región no rompe
    expect(idiomaDeLaPagina('es-AR')).toBe('es');
  });
});

describe('las páginas están completas', () => {
  it.each(PAGINAS)('%s existe en los tres idiomas', (pagina) => {
    const faltan = IDIOMAS.filter(l => !existsSync(join(WEB, `${pagina}.${l}.html`)));
    expect(faltan).toEqual([]);
  });

  it('la de borrado pone los PASOS antes que todo lo demás', () => {
    // «Prominentemente» es literal en la política de Google: si los pasos
    // quedan abajo de las advertencias, el requisito no se cumple.
    const html = readFileSync(join(WEB, 'borrar-cuenta.es.html'), 'utf8');
    const pasos = html.indexOf('Cómo se hace');
    const queSeBorra = html.indexOf('Qué se borra');
    expect(pasos).toBeGreaterThan(-1);
    expect(pasos).toBeLessThan(queSeBorra);
  });

  it('la de borrado declara la retención de las deudas', () => {
    const html = readFileSync(join(WEB, 'borrar-cuenta.es.html'), 'utf8');
    expect(html).toMatch(/deudas abiertas/i);
  });

  it('ninguna ofrece desactivar, pausar o congelar la cuenta', () => {
    // Las dos prohibiciones de Google. Una sola palabra de consuelo acá es
    // motivo de rechazo.
    for (const pagina of PAGINAS) {
      for (const l of IDIOMAS) {
        const html = readFileSync(join(WEB, `${pagina}.${l}.html`), 'utf8');
        expect(html).not.toMatch(/desactiv|congel|deactivat|freeze|desativ/i);
      }
    }
  });

  it('el borrado no se completa por mail: el contacto es para preguntas', () => {
    const html = readFileSync(join(WEB, 'borrar-cuenta.es.html'), 'utf8');
    expect(html).toContain('gab.maglia@gmail.com');
    expect(html).toMatch(/No hace falta escribirnos/i);
  });

  it('no cargan NADA de terceros: ni scripts, ni fuentes, ni imágenes remotas', () => {
    // La política afirma que no hay analítica. Una página con un `gtag` la
    // volvería mentira aunque la app siga limpia.
    for (const archivo of readdirSync(WEB)) {
      const html = readFileSync(join(WEB, archivo), 'utf8');
      if (CON_SCRIPT_INLINE.includes(archivo)) {
        // Sin `src`: el script está en la página, no se trae de ningún lado.
        expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
        // Y sin ninguna forma de mandar datos afuera.
        expect(html).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\(|new Image/);
        expect(html).not.toMatch(/gtag\(|googletagmanager|<iframe/i);
      } else {
        expect(html).not.toMatch(/<script|gtag\(|googletagmanager|<iframe/i);
      }
      expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
      expect(html).not.toMatch(/<link[^>]+href\s*=\s*["']https?:/i);
    }
  });

  it('la excepción del script inline es una lista cerrada, y sus páginas existen', () => {
    for (const archivo of CON_SCRIPT_INLINE) {
      expect(readdirSync(WEB)).toContain(archivo);
    }
    expect(CON_SCRIPT_INLINE).toEqual(['abrir.html']);
  });
});

describe('el semáforo', () => {
  it('con LEGAL_DISPONIBLE apagado, ninguna pantalla abre las URLs sin guardar', () => {
    // El precedente es `tienda.ts`: un link muerto ofrecido igual. Acá cada uso
    // tiene que estar detrás del flag hasta que las páginas respondan 200.
    const ofensas: string[] = [];
    for (const archivo of fuentes(join(RAIZ, 'app')).concat(fuentes(join(RAIZ, 'src')))) {
      const src = readFileSync(archivo, 'utf8');
      if (!/urlDeBorrado|urlDePrivacidad|urlDeTerminos/.test(src)) continue;
      if (!src.includes('LEGAL_DISPONIBLE')) ofensas.push(archivo.replace(RAIZ + '/', ''));
    }
    expect(ofensas).toEqual([]);
  });

  it('encenderlo exige que las páginas existan', () => {
    if (!LEGAL_DISPONIBLE) return;
    for (const pagina of PAGINAS) {
      for (const l of IDIOMAS) {
        expect(existsSync(join(WEB, `${pagina}.${l}.html`))).toBe(true);
      }
    }
  });
});

function fuentes(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules') continue;
      out.push(...fuentes(ruta));
    } else if (/\.tsx?$/.test(nombre) && !ruta.endsWith('constants/legal.ts')) {
      out.push(ruta);
    }
  }
  return out;
}
