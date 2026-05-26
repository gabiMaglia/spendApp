import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from 'react-i18next';

interface BalanceSummaryCardProps {
  owedToYou?: number;
  youOwe?: number;
  currency?: CurrencyCode;
}

export function BalanceSummaryCard({ owedToYou = 0, youOwe = 0, currency = 'ARS' }: BalanceSummaryCardProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const net = owedToYou - youOwe;
  const positive = net >= 0;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <Text style={[Typography.label, { color: c.textTertiary, marginBottom: 4 }]}>
        {t('dashboard.balance_global')}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 14 }}>
        <Text style={[Typography.bodyS, { color: positive ? c.semantic.positive : c.semantic.negative, fontWeight: '600' }]}>
          {positive ? t('dashboard.balance_favor') : t('dashboard.balance_contra')}
        </Text>
        <Text style={[
          Typography.amountL,
          { color: positive ? c.semantic.positive : c.semantic.negative, fontSize: 36 },
        ]}>
          {positive ? '+' : '−'}{formatMoney(Math.abs(net), currency)}
        </Text>
      </View>

      <View style={styles.grid}>
        <View style={[styles.cell, { backgroundColor: c.semantic.positiveSoft }]}>
          <Text style={[Typography.label, { color: c.semantic.positiveOnSoft, fontSize: 11 }]}>
            {t('dashboard.owed_to_you')}
          </Text>
          <Text style={[Typography.amountM, { color: c.semantic.positiveOnSoft, fontSize: 20, marginTop: 4 }]}>
            {formatMoney(owedToYou, currency)}
          </Text>
        </View>
        <View style={[styles.cell, { backgroundColor: c.semantic.negativeSoft }]}>
          <Text style={[Typography.label, { color: c.semantic.negativeOnSoft, fontSize: 11 }]}>
            {t('dashboard.you_owe')}
          </Text>
          <Text style={[Typography.amountM, { color: c.semantic.negativeOnSoft, fontSize: 20, marginTop: 4 }]}>
            {formatMoney(youOwe, currency)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing[5],
    borderRadius: Radius['2xl'],
    borderWidth: 1,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  cell: {
    flex: 1,
    padding: 12,
    borderRadius: Radius.md,
  },
});
