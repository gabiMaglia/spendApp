import React from 'react';
import { StyleSheet, type StyleProp, type ImageStyle } from 'react-native';
import { Image } from 'expo-image';

import { useColorScheme } from '@/hooks/use-color-scheme';

const MARMOL_CLARO = require('../../assets/images/marmol-claro.jpg');
const MARMOL_OSCURO = require('../../assets/images/marmol-oscuro.jpg');
// T-137-quater: mismo shader, mismo grosor y forma de veta que el mármol de
// arriba (ver `scripts/generar-marmol-distendido.py`) — la mitad de vetas por
// ancho y sin la capa "pelo", para una lectura más distendida y minimalista.
// No reemplaza al de arriba: es un segundo patrón, para donde el header de
// arriba ya puso el otro y hace falta distinguir las dos superficies sin
// repetir la misma textura (Contactos, T-137).
const MARMOL_CLARO_DISTENDIDO = require('../../assets/images/marmol-claro-distendido.jpg');
const MARMOL_OSCURO_DISTENDIDO = require('../../assets/images/marmol-oscuro-distendido.jpg');

/**
 * **Fondo de mármol de los headers** (T-105, pedido del PO).
 *
 * Una sola imagen estática por tema — no hay versión animada, la eligió el PO
 * sobre una maqueta. Las dos texturas (`assets/images/marmol-claro.jpg` /
 * `marmol-oscuro.jpg`) ya traen un fundido al color de fondo del tema en su
 * último 38%, así que ESTE componente no necesita degradé propio: alcanza con
 * taparla progresivamente con la superficie del header (ver `CollapsibleHeader`
 * y `DetailHeader`, que la montan detrás de su propio tinte).
 *
 * `contentFit="fill"` (pedido del PO, corrección 2026-09-13: "que no se vean
 * pedacitos nomás") — ESTIRA la textura al ancho/alto exacto del contenedor
 * en vez de recortarla (`cover`), así entra siempre la imagen COMPLETA (todas
 * las vetas + el fundido de abajo), sin importar cuánto mida la superficie:
 * el header fijo de `DetailHeader`, o la de `CollapsibleHeader` cambiando de
 * alto al colapsar — `StyleSheet.absoluteFill` ya la sigue en cada re-render.
 * `contentPosition` no aplica con `fill` (no hay recorte que posicionar).
 */
function FondoMarmolInterno({
  style, variante, patron = 'header',
}: {
  style?: StyleProp<ImageStyle>;
  /**
   * Espeja la textura en horizontal (T-137, pedido del PO): dos superficies
   * que usan el mismo `FondoMarmol` pegadas entre sí —el header y el
   * encabezado pegajoso de "Movimientos"— se leían como la MISMA foto
   * repetida, no como una veta continua. Es el mismo archivo, mismo grosor
   * de veta, sólo invertido en X — no hace falta un segundo asset y el borde
   * donde se juntan sigue leyendo parejo.
   */
  variante?: boolean;
  /**
   * Qué textura usar (T-137-quater). `'header'` (default) es la de siempre.
   * `'distendida'` es un segundo patrón —misma forma de veta, generado con el
   * mismo shader— pero más espaciado y tenue: para una superficie que no es
   * el header ni Movimientos y necesita distinguirse sin repetir la misma
   * foto (Contactos).
   */
  patron?: 'header' | 'distendida';
}) {
  const scheme = useColorScheme() ?? 'light';
  const oscuro = scheme === 'dark';
  const fuente = patron === 'distendida'
    ? (oscuro ? MARMOL_OSCURO_DISTENDIDO : MARMOL_CLARO_DISTENDIDO)
    : (oscuro ? MARMOL_OSCURO : MARMOL_CLARO);

  return (
    <Image
      testID="fondo-marmol"
      source={fuente}
      style={[StyleSheet.absoluteFill, variante && { transform: [{ scaleX: -1 }] }, style]}
      contentFit="fill"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * Memoizado (PO 2026-09-22, rendimiento en gama baja): vive dentro de headers
 * que se re-renderizan seguido por cambios de store ajenos (notificaciones,
 * usuario actual, moneda) — sin memo, cada uno de esos renders volvía a
 * correr `useColorScheme()` acá adentro y a armar el árbol de `Image` de
 * nuevo, aunque el mármol en sí nunca cambia. Mismo patrón que
 * `MontoRodante`. Sólo es efectivo si quien llama no arma `style` con un
 * literal nuevo en cada render (ver `CollapsibleHeader`, que lo memoiza).
 */
export const FondoMarmol = React.memo(FondoMarmolInterno);
