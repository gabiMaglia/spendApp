import { ENLACE_BASE, hrefInterno } from '@/src/utils/appLink';

const ESQUEMA_APP = 'spendapp:';

/**
 * **Adónde lleva una URL que llega del sistema** (T-095 · SEC M-2).
 *
 * Expo Router abre por su cuenta cualquier `spendapp://<ruta>` cuando hay sesión, así
 * que la lista blanca de `appLink` no alcanzaba: sólo filtraba la página y el camino
 * sin sesión. Esto corre ANTES de navegar, para toda URL externa.
 *
 * - URL de la app (`spendapp:` o ruta `/…`) → su pantalla si es enlazable, si no `/`.
 * - https de la página de links → igual.
 * - Cualquier otra (login de Google, dev client) → intacta: no es nuestra.
 *
 * Nunca lanza: un error acá cierra la app (ver `NativeIntent` en expo-router).
 */
export function destinoDeUrlExterna(path: string): string {
  try {
    if (typeof path !== 'string' || path.length === 0) return '/';
    if (path.startsWith('/')) return hrefInterno(`${ESQUEMA_APP}/${path}`) ?? '/';
    // Esquema y host son case-insensitive (RFC 3986): comparar sólo en minúsculas, sin
    // tocar `path` — `hrefInterno` necesita el caso original (query, código compacto).
    const enMinuscula = path.toLowerCase();
    if (enMinuscula.startsWith(ESQUEMA_APP)) return hrefInterno(path) ?? '/';
    if (enMinuscula.startsWith(ENLACE_BASE.replace(/\/$/, '').toLowerCase())) return hrefInterno(path) ?? '/';
    return path;
  } catch {
    return '/';
  }
}
