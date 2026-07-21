import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';

/**
 * Positions one or more `<Fab>` children just above the REAL tab bar height
 * (safe-area aware via `useBottomTabBarHeight`), instead of a hardcoded
 * `bottom` guess. MUST be rendered inside a screen that lives under a
 * `Tabs.Navigator` (`app/(tabs)/*`) — the hook throws outside one.
 *
 * Stack screens without a tab bar (e.g. `app/groups/[id].tsx`) should NOT
 * use this wrapper; position their own FAB with a fixed offset instead.
 */
export function FabRow({ children }: { children: React.ReactNode }) {
  const tabBarHeight = useBottomTabBarHeight();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.row, { bottom: tabBarHeight + Spacing[3] }]}
    >
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
