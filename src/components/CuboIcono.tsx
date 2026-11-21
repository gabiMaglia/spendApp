import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { conAlfa } from '@/src/skins/color';

export const CUBO_TAMANO = 60;

/**
 * El cubo de ícono de Aero: tile tintado con su ícono. Lo usan la tarjeta del
 * gasto y el abanico de categorías, que tienen que verse idénticos.
 */
export function CuboIcono({ icono, tinte, resaltado, style, testID }: {
  icono: React.ComponentProps<typeof Ionicons>['name'];
  tinte: string;
  /** Marca el cubo elegido dentro del abanico. */
  resaltado?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.cubo,
        { backgroundColor: conAlfa(tinte, 0.16) },
        resaltado && { borderWidth: 2, borderColor: tinte },
        style,
      ]}
    >
      <Ionicons name={icono} size={28} color={tinte} />
    </View>
  );
}

const styles = StyleSheet.create({
  cubo: {
    width: CUBO_TAMANO, height: CUBO_TAMANO, borderRadius: 18, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
});
