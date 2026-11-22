import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/src/constants/typography';
import { CuboIcono } from '@/src/components/CuboIcono';
import { PASO_FILA, GAP_CUBOS, PAD_CAPSULA, ALTO_FILA } from '@/src/components/menu/calcularAbanico';
import { useSkin } from '@/src/skins/useSkin';
import { useEntradaCapsula } from '@/src/components/menu/useEntradaCapsula';
import type { OpcionCubo } from '@/src/components/menu/tipos';

/**
 * Una cápsula (cubo + nombre, ✓ si es la elegida). Nace sobre el cubo original
 * (`desdeX` a la izquierda, translateY `-indice * PASO`) y viaja a su lugar con
 * spring; la etiqueta se funde un poco después. Salida: más corta que `SALIDA_MS`, que es la que
 * desmonta (no depende del callback de cada cubo).
 */
export function FilaCubo<V>({
  indice, visible, entrar, sinAnimacion, opcion, seleccionado, onPress, scrollY, desdeX, testID,
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
  /** Cuánto hay que correr la cápsula (en X) para que caiga sobre el cubo original. */
  desdeX: number;
  testID?: string;
}) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  const e = skin.elevation.e2;
  const { p, l } = useEntradaCapsula({ indice, visible, entrar, sinAnimacion });

  // El translate va en el contenedor de la fila: el área de toque viaja con el cubo.
  const estiloFila = useAnimatedStyle(() => (
    sinAnimacion ? {} : {
      opacity: Math.min(1, Math.max(0, p.value * 2.5)),
      transform: [
        { translateX: (1 - p.value) * desdeX },
        { translateY: (1 - p.value) * (scrollY.value - indice * PASO_FILA) },
      ],
    }
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
    <Animated.View style={[styles.contenedor, estiloFila]}>
      <Pressable
        onPress={onPress}
        style={[
          styles.fila,
          { backgroundColor: c.surface },
          degradado ? { elevation: e.elevationFallback } : { boxShadow: e.boxShadow },
        ]}
        accessibilityRole="menuitem" accessibilityLabel={opcion.etiqueta}
        accessibilityState={{ selected: seleccionado }}
      >
        <Animated.View style={estiloCubo}>
          <CuboIcono icono={opcion.icono} categoria={opcion.categoria} texto={opcion.texto} fecha={opcion.fecha} tinte={opcion.tinte} resaltado={seleccionado} />
        </Animated.View>
        <Animated.View style={[styles.etiqueta, estiloEtiqueta]}>
          <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>{opcion.etiqueta}</Text>
        </Animated.View>
        {seleccionado && (
          <Ionicons testID={testID ? `${testID}-check` : undefined} name="checkmark" size={20} color={c.brand.primary} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  contenedor: { alignSelf: 'flex-start', maxWidth: '100%' },
  // Radio completo: la píldora mide ALTO_FILA y se redondea a la mitad.
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: GAP_CUBOS,
    padding: PAD_CAPSULA, paddingRight: 16, borderRadius: ALTO_FILA / 2,
  },
  etiqueta: { flexShrink: 1 },
});
