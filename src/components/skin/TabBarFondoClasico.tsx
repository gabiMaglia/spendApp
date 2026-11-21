import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/src/skins/useSkin';

/** Píldora del Clásico: superficie lisa con borde fino, mismas medidas que la del Aero. */
export function TabBarFondoClasico({ bottom, alto, margen }: { bottom: number; alto: number; margen: number }) {
  const c = useColors();
  return (
    <View testID="tabbar-clasico" style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.pildora,
          { left: margen, right: margen, bottom, height: alto, borderRadius: alto / 2, backgroundColor: c.surface, borderColor: c.hair },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pildora: { position: 'absolute', borderWidth: 1 },
});
