import { ENLACE_BASE, hrefInterno } from '@/src/utils/appLink';

const ESQUEMA_APP = 'spendapp:';

/**
 * Esquema reverse-DNS de Google Sign-In, el mismo `iosUrlScheme` que declara el plugin
 * `@react-native-google-signin/google-signin` en `app.json`. Hay un test
 * (`intencionNativa.test.ts`) que ata este valor al de `app.json` para que no se
 * desincronicen — cambiar uno sin el otro rompe ese test a propósito.
 */
export const ESQUEMA_GOOGLE_SIGNIN = 'com.googleusercontent.apps.918898015438-vd4uat4b7q7jj7k6g770hl7rc0tqa1l6:';

/** El dev client de Expo (`expo-development-client`), usado sólo en desarrollo. */
const ESQUEMA_DEV_CLIENT = 'exp+spendapp:';

/**
 * Retorno de Google Sign-In: la ÚNICA forma de URL de ese esquema que pasa intacta.
 *
 * T-120 · SEC M-5: dejar pasar el esquema entero era un bypass — expo-router convierte
 * CUALQUIER esquema en ruta, así que `com.googleusercontent.apps…:/groups/leave?id=` abría
 * `groups/leave`. Se permite sólo el camino del retorno de OAuth.
 */
const RETORNO_GOOGLE = /^\/*oauth2redirect(?:[/?#]|$)/i;

/** Extrae el esquema (`scheme:`) de una URL, en minúsculas, o `undefined` si no tiene uno válido (RFC 3986). */
function esquemaDe(url: string): string | undefined {
  return /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0].toLowerCase();
}

/**
 * Recorta espacios y caracteres de control ASCII de los dos bordes. El parseo WHATWG de
 * URL (el que usa `Linking`/expo-router para navegar de verdad) los recorta por spec;
 * esta comparación de strings no lo hacía — la brecha que abrió el bypass de espacio/tab
 * inicial (T-095 · ronda 3, Defecto 3).
 */
function normalizar(url: string): string {
  return url.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
}

/**
 * **Adónde lleva una URL que llega del sistema** (T-095 · SEC M-2).
 *
 * Expo Router abre por su cuenta cualquier `spendapp://<ruta>` cuando hay sesión, así
 * que la lista blanca de `appLink` no alcanzaba: sólo filtraba la página y el camino
 * sin sesión. Esto corre ANTES de navegar, para toda URL externa.
 *
 * **Deniega por defecto** (ronda 3, tras dos bypasses de normalización — mayúsculas y
 * espacio/tab inicial — encontrados comparando contra un prefijo fijo en vez de clasificar
 * la URL completa):
 * 1. Se normaliza (trim + bordes de control).
 * 2. Si es un link de la app (`spendapp:` en cualquier capitalización, ruta `/…`, o el
 *    https de la página) → su pantalla si es enlazable, si no `/`.
 * 3. Si no, pasa intacta SÓLO el retorno de OAuth de Google y, en desarrollo, el dev client
 *    (T-120).
 * 4. Cualquier otro caso → `/`.
 *
 * Nunca lanza: un error acá cierra la app (ver `NativeIntent` en expo-router).
 */
export function destinoDeUrlExterna(pathCrudo: string, isDev: boolean = __DEV__): string {
  try {
    if (typeof pathCrudo !== 'string' || pathCrudo.length === 0) return '/';
    const path = normalizar(pathCrudo);
    if (path.length === 0) return '/';

    if (path.startsWith('/')) return hrefInterno(`${ESQUEMA_APP}/${path}`) ?? '/';

    // Esquema y host son case-insensitive (RFC 3986): comparar sólo en minúsculas, sin
    // tocar `path` — `hrefInterno` necesita el caso original (query, código compacto).
    const enMinuscula = path.toLowerCase();
    if (enMinuscula.startsWith(ESQUEMA_APP)) return hrefInterno(path) ?? '/';
    if (enMinuscula.startsWith(ENLACE_BASE.replace(/\/$/, '').toLowerCase())) return hrefInterno(path) ?? '/';

    const esquema = esquemaDe(path);
    // Google: sólo el retorno de OAuth. Cualquier otra ruta con ese esquema, al inicio.
    if (esquema === ESQUEMA_GOOGLE_SIGNIN) {
      return RETORNO_GOOGLE.test(path.slice(esquema.length)) ? pathCrudo : '/';
    }
    // Dev client: sólo en desarrollo. En un build de producción el esquema puede seguir
    // registrado y su `?url=` llevaba a cualquier pantalla (T-120 · SEC M-5).
    if (esquema === ESQUEMA_DEV_CLIENT) return isDev ? pathCrudo : '/';

    return '/';
  } catch {
    return '/';
  }
}
