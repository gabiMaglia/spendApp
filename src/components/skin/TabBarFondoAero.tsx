import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useSkinTokens } from '@/src/skins/useSkin';
import { VidrioMarmol } from './VidrioMarmol';
import { AERO_RADIO } from './headerAeroGeometria';

/**
 * **Fondo de la barra de pestañas en el Aero** (PO 2026-09-26): la misma
 * tarjeta que el header — margen a los costados, radio pronunciado, mármol
 * con vidrio y borde fino — dibujada como `tabBarBackground`.
 *
 * Arranca en el borde de arriba de la barra (ahí se corta el contenido: nada
 * de franja "fantasma" entre el contenido y la tarjeta) y termina `inferior`
 * puntos antes del final, que es la zona del sistema (gestos / tres botones).
 */
export function TabBarFondoAero({ inferior }: { inferior: number }) {
  const skin = useSkinTokens();
  const c = skin.colors;
  return (
    <View testID="tabbar-aero" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} pointerEvents="none">
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
