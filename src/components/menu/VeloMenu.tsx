import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

export const SCRIM = 'rgba(12, 16, 14, 0.5)';

/** Velo oscuro de los menús flotantes. Para el lector de pantalla es el botón «cerrar». */
export function VeloMenu({ visible, estilo, onClose, etiquetaCerrar, testID }: {
  visible: boolean;
  estilo: object;
  onClose: () => void;
  etiquetaCerrar: string;
  testID?: string;
}) {
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFillObject, { backgroundColor: SCRIM }, estilo]}
    >
      <Pressable
        testID={testID}
        style={StyleSheet.absoluteFillObject}
        accessibilityRole="button" accessibilityLabel={etiquetaCerrar}
        onPress={onClose}
      />
    </Animated.View>
  );
}
