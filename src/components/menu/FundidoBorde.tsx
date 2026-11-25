import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useColors } from '@/src/skins/useSkin';
import { degradeFundido } from '@/src/components/menu/degradeFundido';

/** Largo del fundido: más largo que las franjas de antes (32) para que la curva respire. */
const LARGO = 40;

/**
 * Pista de que hay más: el borde lejano de la lista se funde con el velo, con un degradé
 * continuo (`degradeFundido`; PO 2026-11-22, antes eran franjas que se veían una por una)
 * que se apaga al llegar al final del scroll. Vertical: borde inferior. Horizontal: borde
 * derecho, o el izquierdo si la fila crece hacia la izquierda (`alIzquierda`, y entonces
 * el final es el scroll 0).
 */
export function FundidoBorde({ scrollY, maxScroll, horizontal, alIzquierda, color, testID }: {
  /** El valor de scroll en el eje de la lista (se llama `scrollY` por la columna). */
  scrollY: SharedValue<number>;
  maxScroll: number;
  horizontal?: boolean;
  alIzquierda?: boolean;
  /** Color del fondo sobre el que se funde. Por defecto el velo de los abanicos. */
  color?: string;
  testID?: string;
}) {
  const c = useColors();
  const estilo = useAnimatedStyle(() => ({
    opacity: (alIzquierda ? scrollY.value <= 1 : scrollY.value >= maxScroll - 1) ? 0 : 1,
  }));
  const borde = !horizontal ? 'abajo' : alIzquierda ? 'izquierda' : 'derecha';
  return (
    <Animated.View
      testID={testID} pointerEvents="none"
      style={[styles[borde], { experimental_backgroundImage: degradeFundido(color ?? c.velo, borde) }, estilo]}
    />
  );
}

const styles = StyleSheet.create({
  abajo: { position: 'absolute', left: 0, right: 0, bottom: 0, height: LARGO },
  derecha: { position: 'absolute', top: 0, bottom: 0, right: 0, width: LARGO },
  izquierda: { position: 'absolute', top: 0, bottom: 0, left: 0, width: LARGO },
});
