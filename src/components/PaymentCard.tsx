import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface PaymentCardProps {
  fromName: string;
  toName: string;
  amount: number;
  currency?: CurrencyCode;
  date: string;
  note?: string;
}

export function PaymentCard({ fromName, toName, amount, currency = 'ARS', date, note }: PaymentCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.card, { backgroundColor: c.semantic.positiveSoft }]}>
      <View style={[styles.icon, { backgroundColor: c.semantic.positive }]}>
        <Ionicons name="arrow-forward-outline" size={22} color="#fff" />
      </View>
      <View style={styles.info}>
        <Text style={[Typography.bodyL, { color: c.semantic.positiveOnSoft, fontWeight: '600' }]}>
          {fromName} → {toName}
        </Text>
        <Text style={[Typography.bodyS, { color: c.semantic.positiveOnSoft, opacity: 0.75, marginTop: 2 }]}>
          Pago registrado · {date}{note ? ` · ${note}` : ''}
        </Text>
      </View>
      <Text style={[Typography.amountM, { color: c.semantic.positiveOnSoft }]}>
        {formatMoney(amount, currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: Spacing.cardPad,
    borderRadius: Radius.lg,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
});
