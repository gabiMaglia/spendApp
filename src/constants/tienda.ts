import { Platform } from 'react-native';

/**
 * Los enlaces a las tiendas, y por qué hoy no se muestran.
 *
 * `app/(tabs)/user.tsx` tenía una sección «Tienda» con dos filas —«Calificar la
 * app» y «Enviar comentarios»— y **las dos llamaban al mismo handler**, que
 * abría `https://apps.apple.com/app/id000000000`. Ese id es relleno: el link no
 * lleva a ningún lado. Y lo abría también en Android, donde ni siquiera
 * corresponde la tienda.
 *
 * O sea que hoy fallan las dos cosas a la vez: quien quiere calificar no puede,
 * y quien quiere mandar un comentario —que es una acción distinta y ni siquiera
 * es una tienda— termina en la misma pared.
 *
 * Mismo criterio que `ADS_DISPONIBLES` y `PRO_DISPONIBLE`: **no se le ofrece al
 * usuario una puerta que no lleva a ningún lado.** La sección se esconde hasta
 * que la app esté publicada y existan los ids de verdad.
 *
 * **Para el que la encienda:** hay que poner los dos ids reales Y separar el
 * feedback, que no es un link de tienda sino un `mailto:` o un formulario. El
 * test de `tienda.test.ts` se cae si se enciende con los ids de relleno puestos.
 */

/** Placeholder: el id real sale recién cuando la app existe en App Store Connect. */
export const APP_STORE_ID = '000000000';

/** El `package` de Android ya es el definitivo; el link sirve al publicar. */
export const PLAY_PACKAGE = 'com.splitp2p.app';

/** Se enciende cuando la app está publicada en las dos tiendas. */
export const TIENDA_DISPONIBLE = false;

/** El link de la tienda que corresponde a esta plataforma. */
export function urlDeTienda(): string {
  return Platform.OS === 'ios'
    ? `https://apps.apple.com/app/id${APP_STORE_ID}`
    : `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
}
