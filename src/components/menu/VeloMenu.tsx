import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useColors } from '@/src/skins/useSkin';

/** Velo oscuro de los menús flotantes. Para el lector de pantalla es el botón «cerrar». */
export function VeloMenu({ visible, estilo, onClose, etiquetaCerrar, testID }: {
  visible: boolean;
  estilo: object;
  onClose: () => void;
  etiquetaCerrar: string;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFillObject, { backgroundColor: c.velo }, estilo]}
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
