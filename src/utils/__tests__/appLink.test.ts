import { ENLACE_BASE, MAX_URL, enlaceCompacto, enlaceCompartible, hrefInterno, rutaDeEnlace } from '@/src/utils/appLink';

/**
 * **Los links que se comparten son `https`, no `spendapp://`** (PO, 2026-09-12).
 *
 * Gmail —y casi cualquier cliente de mail o chat— sólo convierte en link lo que empieza
 * con `http(s)://`. Un `spendapp://contact/add?...` llegaba como texto plano con un pedazo
 * subrayado. El link apunta a una página que abre la app, y los datos van en el FRAGMENTO
 * (`#…`), que el navegador nunca manda al servidor: el link de contacto lleva un secreto.
 */

describe('enlaceCompartible', () => {
  it('es https y lleva la ruta y los parámetros en el fragmento', () => {
    const link = enlaceCompartible('contact/add', new URLSearchParams({ id: 'u1', name: 'José Pérez' }));
    expect(link.startsWith('https://')).toBe(true);
    expect(link.startsWith(`${ENLACE_BASE}#contact/add?`)).toBe(true);
    // Nada de los datos antes del `#`: eso sí viaja al servidor.
    expect(link.split('#')[0]).toBe(ENLACE_BASE);
    expect(link).not.toContain(' ');
  });
});

describe('rutaDeEnlace', () => {
  it('lee el link https compartido', () => {
    const r = rutaDeEnlace(`${ENLACE_BASE}#groups/join?g=g1&t=abc`);
    expect(r?.ruta).toBe('groups/join');
    expect(r?.params.get('t')).toBe('abc');
  });

  it('lee el esquema de la app, que es con lo que la página abre la app', () => {
    const r = rutaDeEnlace('spendapp://contact/add?id=u1&name=Jos%C3%A9');
    expect(r?.ruta).toBe('contact/add');
    expect(r?.params.get('name')).toBe('José');
  });

  it('acepta la forma con triple barra del esquema', () => {
    expect(rutaDeEnlace('spendapp:///groups/join?g=1')?.ruta).toBe('groups/join');
  });

  it('rechaza rutas que no son enlazables: no es un abridor de pantallas arbitrarias', () => {
    expect(rutaDeEnlace('spendapp://settings/borrar-cuenta')).toBeNull();
    expect(rutaDeEnlace(`${ENLACE_BASE}#debug/identity`)).toBeNull();
  });

  it('rechaza un https de otro sitio aunque traiga una ruta válida', () => {
    expect(rutaDeEnlace('https://evil.example/abrir.html#contact/add?id=u1')).toBeNull();
  });

  it('rechaza basura sin romper', () => {
    expect(rutaDeEnlace('')).toBeNull();
    expect(rutaDeEnlace('cualquier cosa')).toBeNull();
    expect(rutaDeEnlace('exp+spendapp://expo-development-client/?url=http%3A%2F%2F10.0.2.2')).toBeNull();
  });
});

describe('dónde viven los links', () => {
  it('los nuevos van a la organización, no al GitHub personal', () => {
    const link = enlaceCompacto('c', 'AQQF');
    expect(link).toBe('https://spendapp.github.io/#cAQQF');
    expect(link).not.toContain('gabimaglia');
  });

  it('se leen con y sin la barra final, y en las dos direcciones viejas', () => {
    for (const base of [
      'https://spendapp.github.io/',
      'https://spendapp.github.io',
      'https://gabimaglia.github.io/spendApp/web/abrir',
      'https://gabimaglia.github.io/spendApp/web/abrir.html',
    ]) {
      expect(rutaDeEnlace(`${base}#cAQQF`)?.ruta).toBe('contact/add');
    }
  });

  it('otra página de github.io no es nuestra, aunque traiga un código válido', () => {
    expect(rutaDeEnlace('https://spendapp-evil.github.io/#cAQQF')).toBeNull();
    expect(rutaDeEnlace('https://evil.github.io/spendapp.github.io/#cAQQF')).toBeNull();
    expect(rutaDeEnlace('https://gabimaglia.github.io/otra/abrir#cAQQF')).toBeNull();
  });
});

describe('formato compacto', () => {
  it('una letra de tipo y un código se leen como la ruta con ?c=', () => {
    const r = rutaDeEnlace(`${ENLACE_BASE}#cAQQFdS1hbmE`);
    expect(r?.ruta).toBe('contact/add');
    expect(r?.params.get('c')).toBe('AQQFdS1hbmE');
    expect(rutaDeEnlace(`${ENLACE_BASE}#gAQACZzE`)?.ruta).toBe('groups/join');
  });

  it('un tipo desconocido no se interpreta', () => {
    expect(rutaDeEnlace(`${ENLACE_BASE}#xAQQF`)).toBeNull();
  });

  it('hrefInterno lo pasa al router con el código intacto', () => {
    expect(hrefInterno(`${ENLACE_BASE}#cAQQF-_x`)).toBe('/contact/add?c=AQQF-_x');
  });
});

describe('hrefInterno', () => {
  it('convierte cualquiera de las dos formas en una ruta del router', () => {
    expect(hrefInterno(`${ENLACE_BASE}#contact/add?id=u1`)).toBe('/contact/add?id=u1');
    expect(hrefInterno('spendapp://groups/join?g=1')).toBe('/groups/join?g=1');
    expect(hrefInterno('spendapp://settings/borrar-cuenta')).toBeNull();
  });

  it('una URL de más de MAX_URL caracteres no es un link (T-098 L-2)', () => {
    expect(rutaDeEnlace(`spendapp://contact/add?id=u1&name=${'a'.repeat(MAX_URL)}`)).toBeNull();
  });
});
