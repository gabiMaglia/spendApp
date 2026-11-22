import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { SCRIM } from '@/src/components/menu/VeloMenu';

const FRANJAS = 8;
const ALTO_FRANJA = 4;

/**
 * Pista de que hay más abajo: el borde inferior de la columna se funde con el velo.
 * Franjas de opacidad creciente (no hay librería de degradé en el proyecto) que se
 * apagan al llegar al final del scroll.
 */
export function FundidoBorde({ scrollY, maxScroll, testID }: {
  scrollY: SharedValue<number>;
  maxScroll: number;
  testID?: string;
}) {
  const estilo = useAnimatedStyle(() => ({ opacity: scrollY.value >= maxScroll - 1 ? 0 : 1 }));
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.caja, estilo]}>
      {Array.from({ length: FRANJAS }, (_, i) => (
        <View key={i} style={{ height: ALTO_FRANJA, backgroundColor: SCRIM, opacity: (i + 1) / FRANJAS }} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  caja: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FRANJAS * ALTO_FRANJA },
});
