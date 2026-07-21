import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';

/**
 * Distancia del FAB al borde inferior del área de la pantalla.
 *
 * La tab bar de este proyecto NO es `position: absolute` (ver
 * `app/(tabs)/_layout.tsx`), así que React Navigation ya renderiza el contenido
 * de la pantalla POR ENCIMA de la tab bar: `bottom: 0` es el borde superior de
 * la tab bar. Por eso NO se suma `useBottomTabBarHeight()` (eso empujaría el FAB
 * hacia arriba una tab-bar entera — el bug de "FAB super alto"). Solo un gap
 * chico para que quede pegado arriba de la tab bar.
 */
const FAB_BOTTOM_GAP = Spacing[4];

/** Posiciona uno o más `<Fab>` apenas por encima de la tab bar. */
export function FabRow({ children }: { children: React.ReactNode }) {
  return (
    <View pointerEvents="box-none" style={[styles.row, { bottom: FAB_BOTTOM_GAP }]}>
      {children}
    </View>
  );
}

type FabVariant = 'primary' | 'secondary';

interface FabProps {
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  variant?: FabVariant;
  backgroundColor: string;
  borderColor?: string;
  iconColor?: string;
  textColor?: string;
  testID?: string;
}

/** A single floating action button. Compose 2+ inside `<FabRow>` for multi-action FABs. */
export function Fab({
  onPress,
  icon,
  label,
  variant = 'primary',
  backgroundColor,
  borderColor,
  iconColor = '#fff',
  textColor = '#fff',
  testID,
}: FabProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      onPress={() => { hapticLight(); onPress(); }}
      style={[
        isPrimary ? styles.fabPrimary : styles.fabSecondary,
        { backgroundColor },
        borderColor ? { borderWidth: 1, borderColor } : null,
      ]}
    >
      <Ionicons name={icon} size={isPrimary ? 24 : 20} color={iconColor} />
      {label ? (
        <Text style={{ color: textColor, fontSize: isPrimary ? 16 : 14, fontWeight: isPrimary ? '600' : '700' }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fabPrimary: {
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    boxShadow: '0 8px 24px rgba(10,110,143,0.35)',
  },
  fabSecondary: {
    height: 44, paddingHorizontal: 14,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
});
