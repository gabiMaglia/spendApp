import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SkinColors } from '@/src/skins/types';
import { Radius } from '@/src/constants/spacing';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/src/skins/useSkin';

export type SyncState = 'synced' | 'syncing' | 'pending' | 'offline';

const SYNC_META: Record<SyncState, { key: string; iconName: keyof typeof Ionicons.glyphMap; getColor: (c: SkinColors) => string }> = {
  synced:  { key: 'sync.synced',  iconName: 'checkmark-outline',  getColor: c => c.semantic.positive },
  syncing: { key: 'sync.syncing', iconName: 'sync-outline',       getColor: c => c.brand.primary },
  pending: { key: 'sync.pending', iconName: 'ellipse',            getColor: c => c.semantic.warning },
  offline: { key: 'sync.offline', iconName: 'cloud-offline-outline', getColor: c => c.textTertiary },
};

interface SyncStatusBadgeProps {
  state?: SyncState;
}

export function SyncStatusBadge({ state = 'synced' }: SyncStatusBadgeProps) {
  const { t } = useTranslation();
  const c = useColors();
  const meta = SYNC_META[state];
  const iconColor = meta.getColor(c);

  return (
    <View style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Ionicons name={meta.iconName} size={12} color={iconColor} />
      <Text style={[styles.label, { color: c.textSecondary }]}>{t(meta.key)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});
