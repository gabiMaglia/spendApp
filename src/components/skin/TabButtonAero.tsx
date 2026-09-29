import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

import { HapticTab } from '@/components/haptic-tab';
import { useSkin } from '@/src/skins/useSkin';

/**
 * **Botón de pestaña del Aero** (T-227 punto 10, PO 2026-09-29): la elegida
 * se marca con una píldora detrás del ícono y el label — el mismo lenguaje
 * que las pestañas `Segmented` del Aero — en vez de la rayita debajo del
 * label, que quedaba pegada al borde de la tarjeta y se veía rara.
 */
export function TabButtonAero({ children, ...props }: BottomTabBarButtonProps) {
  const { skin, degradado } = useSkin();
  const elegida = props['aria-selected'] === true;
  const pildora = elegida && [
    { backgroundColor: skin.colors.surface },
    degradado
      ? { elevation: skin.elevation.e1.elevationFallback }
      : { boxShadow: skin.elevation.e1.boxShadow },
  ];
  return (
    <HapticTab {...props}>
      <View testID={elegida ? 'tab-pildora' : undefined} style={[styles.pildora, pildora]}>
        {children}
      </View>
    </HapticTab>
  );
}

const styles = StyleSheet.create({
  pildora: {
    alignItems: 'center', gap: 2,
    paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14,
  },
});
