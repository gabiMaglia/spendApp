import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useSkin } from '@/src/skins/useSkin';
import { VidrioMarmol } from './VidrioMarmol';

/**
 * **Fondo de la barra de pestañas en el Aero**: píldora de mármol con vidrio y
 * borde fino que flota sobre el contenido (T-276, estilo iOS 26). Sin velo
 * detrás: la píldora sola es la que flota.
 */
export function TabBarFondoAero({ bottom, alto, margen }: { bottom: number; alto: number; margen: number }) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  // Sombra corta y suave (T-227 punto 10, PO: «menos altura al shadow»).
  const sombra = degradado
    ? { elevation: skin.elevation.e1.elevationFallback }
    : { boxShadow: skin.elevation.e1.boxShadow };
  return (
    <View testID="tabbar-aero" style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.tarjeta,
          {
            left: margen,
            right: margen,
            bottom,
            height: alto,
            borderRadius: alto / 2,
            backgroundColor: c.surface,
            borderColor: c.bordeMarmol,
          },
          sombra,
        ]}
      >
        <FondoMarmol patron="franja" variante />
        <VidrioMarmol />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    position: 'absolute',
    borderWidth: 1, overflow: 'hidden',
  },
});
