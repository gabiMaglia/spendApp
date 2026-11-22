import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useSkin } from '@/src/skins/useSkin';
import { SuperficieVidrio } from './SuperficieVidrio';

/**
 * **Fondo de la barra de pestañas en el Aero**: píldora de vidrio con borde
 * fino que flota sobre el contenido (T-276, estilo iOS 26; vidrio real en T-292).
 * El contenido de las pestañas pasa por debajo (`useRellenoBarraPestanas`), que
 * es lo que el blur desenfoca. Sin velo detrás: la píldora sola es la que flota.
 */
export function TabBarFondoAero({ bottom, alto, margen }: { bottom: number; alto: number; margen: number }) {
  const { skin, degradado } = useSkin();
  const radio = alto / 2;
  // Sombra de dos capas (T-292): apoya la píldora y la despega del contenido.
  const sombra = degradado
    ? { elevation: skin.elevation.e2.elevationFallback }
    : { boxShadow: skin.elevation.e2.boxShadow };
  return (
    <View testID="tabbar-aero" style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.tarjeta, { left: margen, right: margen, bottom, height: alto, borderRadius: radio }, sombra]}>
        <SuperficieVidrio radio={radio} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { position: 'absolute' },
});
