import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from 'react-i18next';
import { UserAvatarStack } from './UserAvatar';

interface GroupCardProps {
  name: string;
  /** Ids, no datos ya resueltos: así la foto no se puede perder por el camino. */
  memberIds: readonly string[];
  balance: number;
  currency?: CurrencyCode;
  subtitle?: string;
  onPress?: () => void;
}

export function GroupCard({ name, memberIds, balance, currency = 'ARS', subtitle, onPress }: GroupCardProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const settled  = balance === 0;
  const positive = balance > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.surface, borderColor: c.borderHair, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {/* Group tile */}
      <View style={[styles.tile, { backgroundColor: c.brand.primarySoft }]}>
        <Ionicons name="people-outline" size={22} color={c.brand.primaryOnSoft} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text
          style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <UserAvatarStack userIds={memberIds} size={18} max={3} />
          <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
            {t('groups.members_count', { count: memberIds.length })}
            {subtitle ? ` · ${subtitle}` : ''}
          </Text>
        </View>
      </View>

      {/* Balance */}
      <View style={styles.balanceCol}>
        {settled ? (
          <View style={[styles.settledPill, { backgroundColor: c.surfaceSunken }]}>
            <Text style={[Typography.caption, { color: c.textTertiary, fontWeight: '600' }]}>
              {t('common.settled')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={[Typography.caption, {
              color: positive ? c.semantic.positive : c.semantic.negative,
              fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4,
            }]}>
              {positive ? t('dashboard.owes_you') : t('dashboard.you_owe_person')}
            </Text>
            <Text style={[Typography.amountM, {
              color: positive ? c.semantic.positive : c.semantic.negative,
            }]}>
              {formatMoney(Math.abs(balance), currency)}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: Spacing.cardPad,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  tile: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  balanceCol: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
    maxWidth: 120,
  },
  settledPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
});
