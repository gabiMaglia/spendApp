/**
 * Caché de públicas por autor + resolución + cola de refresco (T-041 · S3/S4).
 *
 * Fachada (T-192): la lógica vive partida en tres archivos, cada uno con un
 * dueño —
 *  - `authorKeysCache.ts`   — la caché persistida (`knownAuthorKeys`/`rememberAuthorKey`).
 *  - `authorKeysResolve.ts` — la unión de fuentes síncrona (`resolveAuthorKeys`).
 *  - `authorKeysRefresh.ts` — la cola de refresco fuera de banda, el atajo D-2
 *    de la propia clave (`conPropiaSoloParaValida`) y `forgetAuthorKeys`/
 *    `reloadAuthorKeys` (que tocan cache Y cola).
 * Esta ruta pública (`@/src/sync/authorKeys`) re-exporta todo lo de antes.
 */
export {
  AUTHOR_KEYS_CACHE_KEY, AUTHOR_KEYS_MAX_PER_AUTHOR, knownAuthorKeys, rememberAuthorKey,
} from './authorKeysCache';
export { resolveAuthorKeys } from './authorKeysResolve';
export {
  conPropiaSoloParaValida,
  AUTHOR_REFRESH_COOLDOWN_MS, AUTHOR_REFRESH_MAX_POR_VUELTA,
  scheduleAuthorRefresh, pendingAuthorRefreshes,
  authorKeysFor, authorKeyWasAsked,
  refreshAuthorKeys, refreshPendingAuthors,
  forgetAuthorKeys, reloadAuthorKeys,
  __resetAuthorSources,
} from './authorKeysRefresh';
