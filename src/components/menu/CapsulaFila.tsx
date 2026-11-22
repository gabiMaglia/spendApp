import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/src/constants/typography';
import { CuboIcono } from '@/src/components/CuboIcono';
import { PAD_CAPSULA } from '@/src/components/menu/calcularAbanico';
import { ALTO_CAPSULA, ALTO_NOMBRE, ANCHO_CAPSULA, PASO_CAPSULA } from '@/src/components/menu/calcularFila';
import { useEntradaCapsula } from '@/src/components/menu/useEntradaCapsula';
import { useSkin } from '@/src/skins/useSkin';
import type { OpcionCubo } from '@/src/components/menu/tipos';

/**
 * La cápsula vertical de la fila: cubo arriba, nombre debajo (✓ junto al nombre si es la
 * actual). Misma animación que `FilaCubo`, pero nace sobre el ancla en X e Y: `origenX` la
 * lleva al borde del ancla y `desdeY` al centro; `scrollX` evita que, tras scrollear,
 * vuelva a un slot que ya no se ve.
 */
export function CapsulaFila<V>({
  indice, posicion, visible, sinAnimacion, opcion, seleccionado, onPress, scrollX, origenX, desdeY, testID,
}: {
  /** Distancia al ancla: define el escalonado. */
  indice: number;
  /** Lugar de izquierda a derecha en el contenido (no coincide con `indice` si crece a la izquierda). */
  posicion: number;
  visible: boolean;
  sinAnimacion: boolean;
  opcion: OpcionCubo<V>;
  seleccionado: boolean;
  onPress: () => void;
  scrollX: SharedValue<number>;
  origenX: number;
  desdeY: number;
  testID?: string;
}) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  const e = skin.elevation.e2;
  const { p, l } = useEntradaCapsula({ indice, visible, entrar: true, sinAnimacion });

  const estiloCapsula = useAnimatedStyle(() => (
    sinAnimacion ? {} : {
      opacity: Math.min(1, Math.max(0, p.value * 2.5)),
      transform: [
        { translateX: (1 - p.value) * (origenX + scrollX.value - posicion * PASO_CAPSULA) },
        { translateY: (1 - p.value) * desdeY },
        { scale: 0.75 + 0.25 * p.value },
      ],
    }
  ));
  const estiloNombre = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, l.value)) }));

  return (
    <Animated.View style={estiloCapsula}>
      <Pressable
        onPress={onPress}
        style={[
          styles.capsula, { backgroundColor: c.surface },
          degradado ? { elevation: e.elevationFallback } : { boxShadow: e.boxShadow },
        ]}
        accessibilityRole="menuitem" accessibilityLabel={opcion.etiqueta}
        accessibilityState={{ selected: seleccionado }}
      >
        <CuboIcono
          icono={opcion.icono} categoria={opcion.categoria} texto={opcion.texto} fecha={opcion.fecha} tinte={opcion.tinte} resaltado={seleccionado}
        />
        <Animated.View style={[styles.nombre, estiloNombre]}>
          {seleccionado && (
            <Ionicons testID={testID ? `${testID}-check` : undefined} name="checkmark" size={13} color={c.brand.primary} />
          )}
          <Text style={[Typography.caption, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>{opcion.etiqueta}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  capsula: {
    width: ANCHO_CAPSULA, height: ALTO_CAPSULA, alignItems: 'center',
    paddingTop: PAD_CAPSULA, paddingHorizontal: PAD_CAPSULA, borderRadius: 20, borderCurve: 'continuous',
  },
  nombre: { flexDirection: 'row', alignItems: 'center', gap: 2, height: ALTO_NOMBRE, marginTop: 6 },
});
