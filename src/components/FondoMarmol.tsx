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
 * `contentPosition="top"` porque las vetas más definidas están arriba de la
 * imagen (1290×720) — cubrir desde abajo mostraría antes la zona ya diluida.
 */
export function FondoMarmol({ style }: { style?: StyleProp<ImageStyle> }) {
  const scheme = useColorScheme() ?? 'light';
  const fuente = scheme === 'dark' ? MARMOL_OSCURO : MARMOL_CLARO;

  return (
    <Image
      testID="fondo-marmol"
      source={fuente}
      style={[StyleSheet.absoluteFill, style]}
      contentFit="cover"
      contentPosition="top"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
