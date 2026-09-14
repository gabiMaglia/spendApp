/**
 * **El sitio público de la app: `https://spendapp.github.io`** (PO, 2026-09-12).
 *
 * La organización gratuita de GitHub `spendapp`: no pide tarjeta, no tiene un plan pago que
 * se active solo, y el link no muestra el usuario personal del PO. Sirve las páginas legales
 * (privacidad, términos, borrado de cuenta — las URLs que van a la ficha de la tienda y a
 * Data Safety) y la página que abre la app desde un link.
 *
 * La fuente de verdad es `docs/web/` de este repo; `scripts/publicar-sitio.sh` la publica.
 * Si algún día hay dominio propio, se apunta y **cambia sólo esta línea**.
 *
 * Vive aparte de `legal.ts` porque ese módulo importa i18n, y los links de invitación se
 * arman desde `src/sync/`, que no tiene por qué cargar traducciones.
 */
export const BASE_URL = 'https://spendapp.github.io';

/**
 * Dónde viven los links que comparte la app. Con la barra final: el link es
 * `https://spendapp.github.io/#…`, y el `index.html` del sitio es `docs/web/abrir.html`.
 */
export const LINKS_URL = `${BASE_URL}/`;

/**
 * Apple Developer Team ID (PO, 2026-09-14). Arma el appID del AASA del sitio:
 * `<TEAM>.<bundleIdentifier>` (T-097). Un test lo ata a `app.json` y al AASA.
 */
export const APPLE_TEAM_ID = '4GP6785MU4';

/**
 * Id de spendApp en App Store (PO, 2026-09-14). Lo usan el Smart App Banner y el botón
 * «Descargar» de `docs/web/abrir.html` (T-097).
 */
export const APP_STORE_ID = '6801922014';
