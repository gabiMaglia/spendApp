import React from 'react';
import { StyleSheet, type StyleProp, type ImageStyle } from 'react-native';
import { Image } from 'expo-image';

import { useColorScheme } from '@/hooks/use-color-scheme';

const MARMOL_CLARO = require('../../assets/images/marmol-claro.jpg');
const MARMOL_OSCURO = require('../../assets/images/marmol-oscuro.jpg');

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
export function FondoMarmol({ style }: { style?: StyleProp<ImageStyle> }) {
  const scheme = useColorScheme() ?? 'light';
  const fuente = scheme === 'dark' ? MARMOL_OSCURO : MARMOL_CLARO;

  return (
    <Image
      testID="fondo-marmol"
      source={fuente}
      style={[StyleSheet.absoluteFill, style]}
      contentFit="fill"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
