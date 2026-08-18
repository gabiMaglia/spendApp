import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import type { CategoryKind } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CATEGORY_META: Record<CategoryKind, { iconName: keyof typeof Ionicons.glyphMap }> = {
  food:          { iconName: 'restaurant-outline' },
  transport:     { iconName: 'car-outline' },
  accommodation: { iconName: 'home-outline' },
  entertainment: { iconName: 'musical-notes-outline' },
  utilities:     { iconName: 'flash-outline' },
  health:        { iconName: 'heart-outline' },
  shopping:      { iconName: 'bag-outline' },
  other:         { iconName: 'ellipsis-horizontal-outline' },
};

interface CategoryIconProps {
  kind?: CategoryKind;
  size?: number;
}

export function CategoryIcon({ kind = 'other', size = 40 }: CategoryIconProps) {
  const scheme = useColorScheme() ?? 'light';
  // Las categorías de ingreso (sueldo, freelance) no están en este mapa: son
  // sólo para movimientos personales. Antes, destructurar `undefined` tiraba la
  // pantalla entera. Un ícono genérico es infinitamente mejor que un crash.
  const conocida: CategoryKind = kind in CATEGORY_META ? kind : 'other';
  const color = Colors[scheme].category[conocida];
  const iconSize = Math.round(size * 0.55);
  const { iconName } = CATEGORY_META[conocida];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Ionicons name={iconName} size={iconSize} color="#fff" />
    </View>
  );
}

export { CATEGORY_META };
export type { CategoryKind };
