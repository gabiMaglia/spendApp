import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FondoMarmol } from '@/src/components/FondoMarmol';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';
import { VidrioMarmol } from './VidrioMarmol';
import { AERO_RADIO } from './headerAeroGeometria';

/**
 * Opacidad del velo detrás de la barra de pestañas (T-227 punto 9, PO: «como
 * el header pero con un blur muchísimo más intenso, que apenas se vea
 * detrás»): apenas se ve lo de atrás. Es el sustituto del blur, que no se
 * puede usar — `expo-blur` crashea en Android 11 (ver `VeloHeader`).
 */
export const VELO_BARRA_OPACIDAD = 0.88;

/**
 * **Fondo de la barra de pestañas en el Aero** (PO 2026-09-26): la misma
 * tarjeta que el header — margen a los costados, radio pronunciado, mármol
 * con vidrio y borde fino — dibujada como `tabBarBackground`.
 *
 * La tarjeta arranca en el borde de arriba de la barra y termina `inferior`
 * puntos antes del final, que es la zona del sistema (gestos / tres botones).
 * Desde T-227 la barra flota sobre el contenido: detrás de la tarjeta va un
 * velo denso del color de fondo en vez del fondo opaco.
 */
export function TabBarFondoAero({ inferior }: { inferior: number }) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  // Sombra corta y suave (T-227 punto 10, PO: «menos altura al shadow»).
  const sombra = degradado
    ? { elevation: skin.elevation.e1.elevationFallback }
    : { boxShadow: skin.elevation.e1.boxShadow };
  return (
    <View testID="tabbar-aero" style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        testID="velo-barra"
        style={[StyleSheet.absoluteFill, { backgroundColor: conAlfa(c.bg, VELO_BARRA_OPACIDAD) }]}
      />
      <View
        style={[
          styles.tarjeta,
          {
            left: skin.space.inset,
            right: skin.space.inset,
            bottom: inferior,
            backgroundColor: c.surface,
            borderColor: c.hair,
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
    position: 'absolute', top: 0,
    borderWidth: 1, borderRadius: AERO_RADIO, overflow: 'hidden',
  },
});
