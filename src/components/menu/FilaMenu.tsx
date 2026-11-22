import React, { useEffect } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

import { DURACION, ESCALONADO_MS } from '@/src/constants/movimiento';

const FILAS_ESCALONADAS = 6;
const DESPLAZAMIENTO = 6;

/** Envoltorio de una fila: a11y de menuitem y entrada escalonada (las primeras 6). */
export function FilaMenu({
  indice, entrar, sinAnimacion, selected, onPress, onLayout, children,
}: {
  indice: number;
  /** El menú ya tiene posición: arranca la entrada. */
  entrar: boolean;
  sinAnimacion: boolean;
  selected: boolean;
  onPress: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const estatica = sinAnimacion || indice >= FILAS_ESCALONADAS;
  const p = useSharedValue(estatica ? 1 : 0);

  useEffect(() => {
    if (estatica) { p.value = 1; return; }
    if (entrar) p.value = withDelay(indice * ESCALONADO_MS, withTiming(1, { duration: DURACION.corta }));
  }, [entrar, estatica, indice, p]);

  const estilo = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * DESPLAZAMIENTO }],
  }));

  return (
    <Animated.View
      style={estatica ? undefined : estilo}
      onLayout={onLayout}
      accessible accessibilityRole="menuitem" accessibilityState={{ selected }}
      onAccessibilityTap={onPress}
    >
      {children}
    </Animated.View>
  );
}
