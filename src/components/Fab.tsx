import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';

/**
 * FAB del reskin: rectángulo redondeado (Radius.lg), no pill, sin escala al
 * tocar. Igual que antes NO se suma `useBottomTabBarHeight()`: la tab bar no
 * es absolute, así que `bottom: 0` ya es su borde superior.
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
      style={({ pressed }) => [
        styles.fab,
        isPrimary ? styles.fabPrimary : styles.fabSecondary,
        { backgroundColor },
        borderColor ? { borderWidth: 1, borderColor } : null,
        pressed && { opacity: 0.9 },
      ]}
    >
      <Ionicons name={icon} size={17} color={iconColor} />
      {label ? (
        <Text style={{ color: textColor, fontSize: 14.5, fontWeight: '700' }}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    right: Spacing.screenPad,
    left: Spacing.screenPad,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 9,
  },
  fab: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Sombra sólo en el primario: es la única superficie elevada del tema.
  fabPrimary:   { boxShadow: '0 6px 16px rgba(20,60,40,0.22)' },
  fabSecondary: {},
});
