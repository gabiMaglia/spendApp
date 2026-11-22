import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { SCRIM } from '@/src/components/menu/VeloMenu';

const FRANJAS = 8;
const ALTO_FRANJA = 4;

/**
 * Pista de que hay más: el borde lejano de la lista se funde con el velo. Franjas de
 * opacidad creciente (no hay librería de degradé en el proyecto) que se apagan al llegar
 * al final del scroll. Vertical: borde inferior. Horizontal: borde derecho, o el izquierdo
 * si la fila crece hacia la izquierda (`alIzquierda`, y entonces el final es el scroll 0).
 */
export function FundidoBorde({ scrollY, maxScroll, horizontal, alIzquierda, testID }: {
  /** El valor de scroll en el eje de la lista (se llama `scrollY` por la columna). */
  scrollY: SharedValue<number>;
  maxScroll: number;
  horizontal?: boolean;
  alIzquierda?: boolean;
  testID?: string;
}) {
  const estilo = useAnimatedStyle(() => ({
    opacity: (alIzquierda ? scrollY.value <= 1 : scrollY.value >= maxScroll - 1) ? 0 : 1,
  }));
  const posicion = !horizontal ? styles.abajo : alIzquierda ? styles.izquierda : styles.derecha;
  return (
    <Animated.View
      testID={testID} pointerEvents="none"
      style={[posicion, horizontal && styles.fila, estilo]}
    >
      {Array.from({ length: FRANJAS }, (_, i) => {
        const o = (alIzquierda ? FRANJAS - i : i + 1) / FRANJAS;
        return (
          <View
            key={i}
            style={[horizontal ? { width: ALTO_FRANJA } : { height: ALTO_FRANJA }, { backgroundColor: SCRIM, opacity: o }]}
          />
        );
      })}
    </Animated.View>
  );
}

const LARGO = FRANJAS * ALTO_FRANJA;
const styles = StyleSheet.create({
  abajo: { position: 'absolute', left: 0, right: 0, bottom: 0, height: LARGO },
  derecha: { position: 'absolute', top: 0, bottom: 0, right: 0, width: LARGO },
  izquierda: { position: 'absolute', top: 0, bottom: 0, left: 0, width: LARGO },
  fila: { flexDirection: 'row' },
});
