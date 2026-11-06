import React from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/src/constants/typography';
import type { StatItem } from '@/src/components/band/Stats';

/** Etiqueta del casillero; con `onPress`, una flechita al lado avisa que se toca. */
export function EtiquetaDeStat({ it, color }: { it: StatItem; color: string }) {
  const texto = <Text style={[Typography.label, { color, textTransform: 'uppercase' }]}>{it.label}</Text>;
  // Sin flechita, el Text solo: un View de más por casillero suma nodos en
  // pantallas con tope medido (perfVistasInicio, T-216).
  if (!it.onPress) return texto;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {texto}
      <Ionicons name="chevron-forward" size={12} color={color} />
    </View>
  );
}

/** Envuelve en `Pressable` sólo si el casillero tiene `onPress`. */
export function Tocable({ it, style, testID, children }: {
  it: StatItem; style?: StyleProp<ViewStyle>; testID?: string; children: React.ReactNode;
}) {
  if (!it.onPress) return <View testID={testID} style={style}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={it.onPress}
      accessibilityRole="button"
      accessibilityLabel={it.label}
      style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}
