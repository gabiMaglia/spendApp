import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { formatAmount } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface BalancePillProps {
  amount: number;
  currency?: CurrencyCode;
  size?: 'sm' | 'md' | 'lg';
}

export function BalancePill({ amount, currency = 'ARS', size = 'md' }: BalancePillProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const settled = amount === 0;
  const positive = amount > 0;

  const bg = settled  ? c.surfaceSunken
    : positive        ? c.semantic.positiveSoft
    :                   c.semantic.negativeSoft;

  const fg = settled  ? c.textTertiary
    : positive        ? c.semantic.positiveOnSoft
    :                   c.semantic.negativeOnSoft;

  const padding = size === 'sm' ? { paddingHorizontal: 8, paddingVertical: 2 }
    : size === 'lg'             ? { paddingHorizontal: 12, paddingVertical: 6 }
    :                             { paddingHorizontal: 10, paddingVertical: 3 };

  const fontSize = size === 'sm' ? 12 : size === 'lg' ? 15 : 13;

  const sign = positive ? '+' : amount < 0 ? '−' : '';
  const symbol = require('@/src/constants/currencies').getCurrency(currency).symbol;

  return (
    <View style={[styles.pill, { backgroundColor: bg, borderRadius: 9999 }, padding]}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ color: fg, fontSize, fontWeight: '700', fontVariant: ['tabular-nums'] }}
      >
        {sign}{symbol}{formatAmount(Math.abs(amount), currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
