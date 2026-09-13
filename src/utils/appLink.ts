import { BASE_URL_VIEJA, LINKS_URL } from '@/src/constants/web';

/**
 * **Los links que la app comparte** (PO, 2026-09-12).
 *
 * Antes eran `spendapp://…`, y Gmail —como casi cualquier cliente de mail o chat— sólo
 * convierte en link lo que empieza con `http(s)://`: llegaban como texto con un pedazo
 * subrayado. Ahora se comparte un `https` a la página de `docs/web/abrir.html`, publicada en
 * `https://spendapp.github.io/`, que abre la app.
 *
 * ⚠️ **Los datos van en el FRAGMENTO (`#ruta?params`), nunca en la query.** El navegador
 * no manda el fragmento al servidor, y el link de contacto lleva el secreto del canal: en
 * la query quedaría en los logs de GitHub Pages.
 *
 * App Links / Universal Links abrirían la app sin pasar por el navegador. Exigen un archivo
 * en la RAÍZ del dominio (`/.well-known/…`): con `spendapp.github.io` la raíz es nuestra y se
 * puede, pero pide recompilar el nativo. No está hecho.
 */

/**
 * La base de los links nuevos: `https://spendapp.github.io/` (ver `constants/web`).
 *
 * Las bases VIEJAS se siguen leyendo: hay links ya compartidos que apuntan a la página en
 * el GitHub personal del PO, con `.html` y sin él. Esa página sigue publicada (`docs/web`).
 */
export const ENLACE_BASE = LINKS_URL;
const BASES_ACEPTADAS = [
  LINKS_URL,                          // https://spendapp.github.io/#…
  LINKS_URL.replace(/\/$/, ''),       // https://spendapp.github.io#…  (sin la barra)
  `${BASE_URL_VIEJA}/abrir`,          // links compactos del 2026-09-12, antes de mudarse
  `${BASE_URL_VIEJA}/abrir.html`,     // links largos del 2026-09-12
];

/**
 * Formato compacto (`utils/linkCompacto`): una letra de tipo y el código. La página no
 * decodifica — abre la ruta con `?c=<código>` y la app decodifica.
 */
export const TIPOS_COMPACTOS = { c: 'contact/add', g: 'groups/join' } as const;
type TipoCompacto = keyof typeof TIPOS_COMPACTOS;

const ESQUEMA = 'spendapp:';

/**
 * Las únicas pantallas que un link puede abrir. Es una lista cerrada a propósito: un link
 * llega de afuera, y no tiene por qué poder abrir cualquier pantalla de la app. La página
 * `abrir.html` repite esta misma lista, y un guard verifica que coincidan.
 */
export const RUTAS_ENLAZABLES = ['contact/add', 'groups/join'] as const;
export type RutaEnlazable = (typeof RUTAS_ENLAZABLES)[number];

/** Formato largo: la ruta y los parámetros legibles. Es el respaldo del compacto. */
export function enlaceCompartible(ruta: RutaEnlazable, params: URLSearchParams): string {
  return `${ENLACE_BASE}#${ruta}?${params.toString()}`;
}

/** Formato compacto: `…/abrir#c<código>`. */
export function enlaceCompacto(tipo: TipoCompacto, codigo: string): string {
  return `${ENLACE_BASE}#${tipo}${codigo}`;
}

function esEnlazable(ruta: string): ruta is RutaEnlazable {
  return (RUTAS_ENLAZABLES as readonly string[]).includes(ruta);
}

/**
 * Lee un link de la app en cualquiera de sus dos formas: el `https` que se comparte, o
 * el `spendapp://` con el que esa página abre la app. `null` para todo lo demás.
 */
export function rutaDeEnlace(urlCruda: string): { ruta: RutaEnlazable; params: URLSearchParams } | null {
  if (typeof urlCruda !== 'string' || urlCruda.length === 0) return null;
  // Recorta espacio/control de los bordes: sin esto, un `" spendapp://…"` no matcheaba
  // ningún esquema y se leía como link ajeno en vez de caer al filtro (T-095 · ronda 3).
  const url = urlCruda.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
  if (url.length === 0) return null;

  // El esquema y el host son case-insensitive por RFC 3986 (T-095 · R-1): el SO no
  // garantiza que lleguen en minúsculas. Sólo se compara en minúsculas — el resto
  // (ruta, query, el código base64url del formato compacto) conserva su caso original.
  const enMinuscula = url.toLowerCase();
  let resto: string;
  const base = BASES_ACEPTADAS.find(b => enMinuscula.startsWith(`${b.toLowerCase()}#`));
  if (base !== undefined) {
    resto = url.slice(base.length + 1);
  } else if (enMinuscula.startsWith(ESQUEMA)) {
    resto = url.slice(ESQUEMA.length).replace(/^\/+/, '');
  } else {
    return null;
  }

  // Compacto: una letra de tipo y un código base64url, sin `/` ni `?`.
  const compacto = /^([a-z])([A-Za-z0-9_-]+)$/.exec(resto);
  if (compacto && compacto[1] in TIPOS_COMPACTOS) {
    return {
      ruta: TIPOS_COMPACTOS[compacto[1] as TipoCompacto],
      params: new URLSearchParams({ c: compacto[2] }),
    };
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
