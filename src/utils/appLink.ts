import { BASE_URL } from '@/src/constants/web';

/**
 * **Los links que la app comparte** (PO, 2026-09-12).
 *
 * Antes eran `spendapp://…`, y Gmail —como casi cualquier cliente de mail o chat— sólo
 * convierte en link lo que empieza con `http(s)://`: llegaban como texto con un pedazo
 * subrayado. Ahora se comparte un `https` a `docs/web/abrir.html`, que abre la app.
 *
 * ⚠️ **Los datos van en el FRAGMENTO (`#ruta?params`), nunca en la query.** El navegador
 * no manda el fragmento al servidor, y el link de contacto lleva el secreto del canal: en
 * la query quedaría en los logs de GitHub Pages.
 *
 * Por qué no App Links / Universal Links, que abrirían la app sin pasar por el navegador:
 * exigen un archivo en la RAÍZ del dominio (`/.well-known/…`), y en una página de proyecto
 * de GitHub Pages la raíz no es nuestra. Con dominio propio se puede; ver `constants/web`.
 */

export const ENLACE_BASE = `${BASE_URL}/abrir.html`;

const ESQUEMA = 'spendapp:';

/**
 * Las únicas pantallas que un link puede abrir. Es una lista cerrada a propósito: un link
 * llega de afuera, y no tiene por qué poder abrir cualquier pantalla de la app. La página
 * `abrir.html` repite esta misma lista, y un guard verifica que coincidan.
 */
export const RUTAS_ENLAZABLES = ['contact/add', 'groups/join'] as const;
export type RutaEnlazable = (typeof RUTAS_ENLAZABLES)[number];

export function enlaceCompartible(ruta: RutaEnlazable, params: URLSearchParams): string {
  return `${ENLACE_BASE}#${ruta}?${params.toString()}`;
}

function esEnlazable(ruta: string): ruta is RutaEnlazable {
  return (RUTAS_ENLAZABLES as readonly string[]).includes(ruta);
}

/**
 * Lee un link de la app en cualquiera de sus dos formas: el `https` que se comparte, o
 * el `spendapp://` con el que esa página abre la app. `null` para todo lo demás.
 */
export function rutaDeEnlace(url: string): { ruta: RutaEnlazable; params: URLSearchParams } | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  let resto: string;
  if (url.startsWith(`${ENLACE_BASE}#`)) {
    resto = url.slice(ENLACE_BASE.length + 1);
  } else if (url.startsWith(ESQUEMA)) {
    resto = url.slice(ESQUEMA.length).replace(/^\/+/, '');
  } else {
    return null;
  }

  const q = resto.indexOf('?');
  const ruta = (q === -1 ? resto : resto.slice(0, q)).replace(/\/+$/, '');
  if (!esEnlazable(ruta)) return null;

  try {
    return { ruta, params: new URLSearchParams(q === -1 ? '' : resto.slice(q + 1)) };
  } catch {
    return null;
  }
}

/** La ruta del router para un link de la app (`/contact/add?…`), o `null`. */
export function hrefInterno(url: string): string | null {
  const r = rutaDeEnlace(url);
  if (!r) return null;
  const query = r.params.toString();
  return `/${r.ruta}${query ? `?${query}` : ''}`;
}
