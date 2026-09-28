/**
 * Sync por el relay: fachada (T-192). La lógica vive partida en
 * `src/sync/relay/`, cada módulo con un dueño:
 *  - `relay/publicar.ts`       — arma el payload del grupo y publica por cubos.
 *  - `relay/drenar.ts`         — pagina el buzón, abre sobres y aplica lo recibido.
 *  - `relay/abrirSobre.ts`     — verifica firma/cifrado y clasifica manifiesto vs rebanada.
 *  - `relay/aplicarAcotado.ts` — acota un delta a `groupId` y lo aplica.
 *  - `relay/relectura.ts`      — relectura acotada de ckeys que un manifiesto declaró faltantes.
 *  - `relay/claveVigente.ts`   — ¿la clave del grupo sigue siendo la de la foto?
 *  - `relay/chequeoManifiesto.ts` — chequeo final de manifiesto + relectura.
 *  - `relay/cierreDeDrenaje.ts`  — núcleo PURO del cierre (cursor, retenidas; frontera P15).
 * Esta ruta pública (`@/src/sync/relaySync`) re-exporta todo lo de antes:
 * los importadores de producción (`inviteEngine.ts`, `relay/adaptadorHushSplit.ts`
 * via `publish.ts`/`drain.ts`) y los 2 tests que mockean `sync/relaySync` no cambian.
 */
export {
  buildGroupPayload,
  publishToGroup,
  deleteMyGroupEnvelopes,
  type PublishResult,
  PUBLICACION_TIMEOUT_MS,
} from './publicar';

export {
  drainGroup,
  sigueSiendoLaClave,
  DRAIN_FETCH_LIMIT,
  DRAIN_MAX_PAGES,
  type DrainResult,
  type DrainOptions,
} from './drenar';
