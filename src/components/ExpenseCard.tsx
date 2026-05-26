import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { CategoryKind } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar, AvatarStack } from './Avatar';
import { BalancePill } from './BalancePill';
import { CategoryIcon } from './CategoryIcon';

interface ExpenseCardProps {
  category?: CategoryKind;
  title: string;
  payerName: string;
  date: string;
  amount: number;
  currency?: CurrencyCode;
  yourShare?: number;  // undefined = no mostrar share
  splitPeople?: { name: string; hue?: number }[];
  deletionPending?: boolean;
  onPress?: () => void;
}

export function ExpenseCard({
  category = 'other',
  title,
  payerName,
  date,
  amount,
  currency = 'ARS',
  yourShare,
  splitPeople,
  deletionPending,
  onPress,
}: ExpenseCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.borderHair,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <CategoryIcon kind={category} size={42} />

      <View style={styles.middle}>
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
          {payerName} pagó · {date}
        </Text>
        {deletionPending && (
          <Text style={[Typography.caption, { color: c.semantic.warning, marginTop: 2 }]}>
            Eliminación pendiente
          </Text>
        )}
      </View>

      <View style={styles.right}>
        <Text style={[Typography.amountM, { color: c.text }]}>
          {formatMoney(amount, currency)}
        </Text>
        {yourShare !== undefined && (
          <BalancePill amount={yourShare} currency={currency} size="sm" />
        )}
        {splitPeople && yourShare === undefined && (
          <AvatarStack people={splitPeople} size={20} max={4} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: Spacing.cardPad,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  middle: {
    flex: 1,
    minWidth: 0,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
});
