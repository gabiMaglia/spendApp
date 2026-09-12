/**
 * GitHub Pages sobre este mismo repo, sirviendo desde `/docs` (decisión del PO,
 * 2026-09-05). Si algún día hay dominio propio, se apunta y **cambia sólo esta
 * línea**: las páginas y los links quedan igual.
 *
 * Vive aparte de `legal.ts` porque ese módulo importa i18n, y los links de
 * invitación se arman desde `src/sync/`, que no tiene por qué cargar traducciones.
 */
export const BASE_URL = 'https://gabimaglia.github.io/spendApp/web';

/**
 * Dónde viven los links que comparte la app (PO, 2026-09-12): la organización de GitHub
 * `spendapp`, para que el link no muestre el usuario personal del PO. Gratis, sin tarjeta,
 * y la raíz del dominio es de la organización — lo que deja abierta la puerta a App Links /
 * Universal Links más adelante. Con la barra final: el link es `https://spendapp.github.io/#…`.
 */
export const LINKS_URL = 'https://spendapp.github.io/';
