import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  type SharedValue, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';

import { Typography } from '@/src/constants/typography';
import { CuboIcono } from '@/src/components/CuboIcono';
import { PASO_CUBOS, GAP_CUBOS } from '@/src/components/menu/calcularAbanico';
import { FUNDIDO_MS as SALIDA_REDUCIDA_MS, SALIDA_MS } from '@/src/components/menu/useAnimacionMenu';
import type { OpcionCubo } from '@/src/components/menu/tipos';

// «Sharp, swift and soft»: rigidez alta, amortiguación justa (ζ≈0.8, ~1 % de rebote).
const SPRING = { stiffness: 560, damping: 38, mass: 1 };
const ESCALONADO_MS = 22;
const DEMORA_ETIQUETA_MS = 70;
const ETIQUETA_MS = 140;
const FUNDIDO_MS = 90;
const TEXTO_SOBRE_VELO = '#FFFFFF';

/**
 * Un cubo con su nombre. Nace en el rect del cubo original (translateY
 * `-indice * PASO`, el slot 0) y baja a su lugar con spring; la etiqueta se
 * funde un poco después. Salida: más corta que `SALIDA_MS`, que es la que
 * desmonta (no depende del callback de cada cubo).
 */
export function FilaCubo<V>({
  indice, visible, entrar, sinAnimacion, opcion, seleccionado, onPress, scrollY,
}: {
  indice: number;
  visible: boolean;
  /** El abanico ya tiene posición: arranca la entrada. */
  entrar: boolean;
  sinAnimacion: boolean;
  opcion: OpcionCubo<V>;
  seleccionado: boolean;
  onPress: () => void;
  /** Cuánto scrolleó la columna: al recogerse, el cubo vuelve al original VISIBLE, no al slot 0 del contenido. */
  scrollY: SharedValue<number>;
}) {
  const p = useSharedValue(0);
  const l = useSharedValue(0);

  useEffect(() => {
    if (visible && entrar) {
      if (sinAnimacion) {
        p.value = withTiming(1, { duration: FUNDIDO_MS });
        l.value = withTiming(1, { duration: FUNDIDO_MS });
      } else {
        const demora = indice * ESCALONADO_MS;
        p.value = withDelay(demora, withSpring(1, SPRING));
        l.value = withDelay(demora + DEMORA_ETIQUETA_MS, withTiming(1, { duration: ETIQUETA_MS }));
      }
    } else if (!visible) {
      // Con reducir movimiento el Modal se desmonta a los 90 ms: el fundido dura lo mismo.
      const ms = sinAnimacion ? SALIDA_REDUCIDA_MS : SALIDA_MS - 10;
      p.value = withTiming(0, { duration: ms });
      l.value = withTiming(0, { duration: ms });
    }
  }, [visible, entrar, sinAnimacion, indice, p, l]);

  // El translate va en el contenedor de la fila: el área de toque viaja con el cubo.
  const estiloFila = useAnimatedStyle(() => (
    sinAnimacion ? {} : { transform: [{ translateY: (1 - p.value) * (scrollY.value - indice * PASO_CUBOS) }] }
  ));
  const estiloCubo = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, p.value * 2.5)),
    ...(sinAnimacion ? null : { transform: [{ scale: 0.75 + 0.25 * p.value }] }),
  }));
  const estiloEtiqueta = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, l.value)),
    ...(sinAnimacion ? null : { transform: [{ translateX: (1 - l.value) * -8 }] }),
  }));

  return (
    <Animated.View style={estiloFila}>
      <Pressable
        onPress={onPress} style={styles.fila}
        accessibilityRole="menuitem" accessibilityLabel={opcion.etiqueta}
        accessibilityState={{ selected: seleccionado }}
      >
        <Animated.View style={estiloCubo}>
          <CuboIcono icono={opcion.icono} tinte={opcion.tinte} resaltado={seleccionado} />
        </Animated.View>
        <Animated.View style={[styles.etiqueta, estiloEtiqueta]}>
          <Text style={[Typography.bodyL, { color: TEXTO_SOBRE_VELO }]} numberOfLines={1}>{opcion.etiqueta}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: GAP_CUBOS + 4 },
  etiqueta: { flexShrink: 1 },
});
