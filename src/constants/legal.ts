import i18n from '@/src/i18n';

/**
 * Las tres páginas públicas: borrado de cuenta, privacidad y términos (T-090).
 *
 * **La de borrado no es una comodidad: es un requisito de Google Play.** Exige
 * una URL propia donde se pueda *pedir* el borrado **sin instalar la app**, y
 * esa URL va declarada en el formulario de Data Safety. Sin ella, la fila «¿el
 * usuario puede pedir el borrado?» se responde «no» y es rechazo directo.
 *
 * **El flag existe por el precedente de `src/constants/tienda.ts`:** esa
 * pantalla abría un link con un id de relleno —muerto— y lo abría **también en
 * Android**, donde ni siquiera correspondía esa tienda. La lección quedó escrita
 * ahí: no se le ofrece al usuario una puerta que no lleva a ningún lado.
 *
 * ⚠️ **Pero acá el flag NO es una salida, es un semáforo.** Apagar `TIENDA_DISPONIBLE`
 * sólo esconde una comodidad; apagar éste esconde **el link que la tienda
 * exige**. Encenderlo es parte de la Definición de Terminado de T-090, y sólo se
 * enciende cuando las páginas responden 200 desde un navegador **sin la app
 * instalada** — que es la condición literal del requisito y lo único que ningún
 * test puede comprobar.
 */
export const LEGAL_DISPONIBLE = false;

/**
 * GitHub Pages sobre este mismo repo, sirviendo desde `/docs` (decisión del PO,
 * 2026-09-05). Si algún día hay dominio propio, se apunta y **cambia sólo esta
 * línea**: las páginas y los links quedan igual.
 */
export const BASE_URL = 'https://gabimaglia.github.io/spendApp/web';

const IDIOMAS = ['es', 'en', 'pt'] as const;
export type IdiomaLegal = (typeof IDIOMAS)[number];

/**
 * El idioma de la página. Cae a español —la fuente de verdad de los textos— ante
 * cualquier cosa que no sea uno de los tres, incluido `es-AR` o `pt-BR`.
 */
export function idiomaDeLaPagina(lang?: string): IdiomaLegal {
  const base = (lang ?? i18n.language ?? '').slice(0, 2).toLowerCase();
  return (IDIOMAS as readonly string[]).includes(base) ? (base as IdiomaLegal) : 'es';
}

export function urlDeBorrado(lang?: string): string {
  return `${BASE_URL}/borrar-cuenta.${idiomaDeLaPagina(lang)}.html`;
}

export function urlDePrivacidad(lang?: string): string {
  return `${BASE_URL}/privacidad.${idiomaDeLaPagina(lang)}.html`;
}

export function urlDeTerminos(lang?: string): string {
  return `${BASE_URL}/terminos.${idiomaDeLaPagina(lang)}.html`;
}
