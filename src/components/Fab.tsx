import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';

/**
 * Positions one or more `<Fab>` children just above the REAL tab bar, at a
 * fixed `Spacing[3]` gap, on any device.
 *
 * `useBottomTabBarHeight()` INCLUDES the bottom safe-area inset. These screens
 * render `<FabRow>` inside a `SafeAreaView` that ALSO pads that inset at the
 * bottom, so an absolutely-positioned child is already measured from above the
 * inset. Adding the full tab-bar height on top double-counts the inset and
 * floats the FAB too high — so we subtract `insets.bottom` back out. Net
 * distance from the screen bottom = tabBarHeight + gap = just above the tab bar.
 *
 * Assumes the parent applies the bottom inset as padding (true for all
 * `app/(tabs)/*` screens). MUST live under a `Tabs.Navigator` — the hook throws
 * outside one. Stack screens without a tab bar (e.g. `app/groups/[id].tsx`)
 * should NOT use this wrapper.
 */
export function FabRow({ children }: { children: React.ReactNode }) {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(tabBarHeight - insets.bottom, 0) + Spacing[3];
  return (
    <View pointerEvents="box-none" style={[styles.row, { bottom }]}>
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
