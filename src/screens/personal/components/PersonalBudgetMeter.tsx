import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, Meter } from '@/src/components/Band';
import { MoneyText } from '@/src/components/MoneyText';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { hapticLight } from '@/src/utils/haptics';

/** Banda del medidor de presupuesto — con presupuesto configurado, o el estado vacío que ofrece configurarlo. */
export function PersonalBudgetMeter({
  hasBudget, totalSpent, remaining, pct, effectiveBudget, cur,
  personalPending, includeOwedToMe, owedToMe, onOpenBudgetSheet,
}: {
  hasBudget: boolean;
  totalSpent: number;
  remaining: number;
  pct: number;
  effectiveBudget: number;
  cur: CurrencyCode;
  personalPending: boolean;
  includeOwedToMe: boolean;
  owedToMe: number;
  onOpenBudgetSheet: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const pendingCalculando = t('fx.calculating');

  const barColor = pct >= 1 ? c.semantic.negative
    : pct >= 0.8 ? c.semantic.warning
    : c.brand.primary;

  if (!hasBudget) {
    return (
      <Band>
        <Pressable onPress={() => { hapticLight(); onOpenBudgetSheet(); }} style={styles.meterEmpty}>
          <Ionicons name="bar-chart-outline" size={26} color={c.textTertiary} />
          <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
            {t('personal.budget_empty')}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand.primary }}>
            {t('personal.budget_configure')}
          </Text>
        </Pressable>
      </Band>
    );
  }

  return (
    <Band>
      <View style={styles.meterPad}>
        <View style={styles.meterTop}>
          <View>
            <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
              {t('personal.spent')}
            </Text>
            <MoneyText
              minor={totalSpent}
              code={cur}
              rollId="personal.gastado"
              pending={personalPending}
              pendingAccessibilityLabel={pendingCalculando}
              style={[Typography.amountM, { color: c.text }]}
            />
          </View>
          <View style={{ alignItems: 'flex-end', flexShrink: 0, marginLeft: 16 }}>
            <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
              {remaining >= 0 ? t('personal.available') : t('personal.exceeded')}
            </Text>
            <MoneyText
              minor={Math.abs(remaining)}
              code={cur}
              rollId="personal.disponible"
              pending={personalPending}
              pendingAccessibilityLabel={pendingCalculando}
              style={[Typography.amountM, { color: remaining >= 0 ? c.semantic.positive : c.semantic.negative }]}
            />
          </View>
        </View>

        <View style={{ marginTop: 14, marginBottom: 10 }}>
          <Meter pct={pct} color={barColor} />
        </View>

        <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center' }]}>
          {t('personal.budget_progress', { pct: Math.round(pct * 100), amount: formatMoney(effectiveBudget, cur) })}
          {includeOwedToMe && owedToMe > 0
            ? t('personal.budget_includes_owed', { amount: formatMoney(owedToMe, cur) })
            : ''}
        </Text>
      </View>
    </Band>
  );
}

const styles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
  meterPad:  { paddingHorizontal: Spacing.screenPad, paddingTop: 15, paddingBottom: 16 },
  meterTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  meterEmpty:{ alignItems: 'center', gap: 10, paddingVertical: Spacing[6], paddingHorizontal: Spacing[6] },
});
