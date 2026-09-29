import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { UserAvatar } from '@/src/components/UserAvatar';
import { useUserStore } from '@/src/store/userStore';
import { useColors } from '@/src/skins/useSkin';
import {
  roundPct, type PercentSub, type SplitCalculado, type SplitMode,
} from '@/src/screens/expense/repartoDeGasto';

/**
 * Filas de miembros del reparto — compartidas entre el `Band noTop` de Aero y
 * el `View` con borde propio de la tarjeta Clásica (T-210): mismo contenido,
 * sólo cambia quién le pone el marco. T-223: salió de `app/expense/new.tsx`.
 */
export function FilasDeReparto({
  splits, splitMode, percentSub, samePercent, customPercents, onCustomPercentsChange,
  lastPercent, percentError, currency,
}: {
  splits: SplitCalculado[];
  splitMode: SplitMode;
  percentSub: PercentSub;
  samePercent: string;
  customPercents: string[];
  onCustomPercentsChange: (v: string[]) => void;
  lastPercent: number;
  percentError: boolean;
  currency: CurrencyCode;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const getUserName = useUserStore(s => s.getUserName);

  return (
    <>
      {splits.map((split, i) => {
        const name     = getUserName(split.userId);
        const isLast   = split.isLast;
        const showRest = isLast && splitMode === 'percentage';

        return (
          <View
            key={split.userId}
            style={[
              styles.memberRow,
              {
                backgroundColor: showRest ? c.brand.primarySoft : 'transparent',
                borderBottomWidth: i === splits.length - 1 ? 0 : 1,
                borderBottomColor: c.hair2,
              },
            ]}
          >
            <UserAvatar userId={split.userId} name={name} size={32} />
            <Text style={[Typography.bodyM, { flex: 1, color: c.text, fontWeight: '600' }]}>
              {name}
            </Text>

            {splitMode === 'percentage' && percentSub === 'custom' && !isLast && (
              <View style={styles.percentBox}>
                <TextInput
                  value={customPercents[i] ?? ''}
                  onChangeText={v => {
                    const next = [...customPercents];
                    next[i] = v;
                    onCustomPercentsChange(next);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={c.textTertiary}
                  style={[Typography.amountS, { color: c.text, textAlign: 'right', minWidth: 44 }]}
                />
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>%</Text>
              </View>
            )}

            {showRest ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[Typography.caption, { color: c.brand.primaryOnSoft }]}>
                  {lastPercent < 0 ? t('expense.percent_exceeded') : t('expense.percent_rest', { pct: roundPct(lastPercent) })}
                </Text>
                <Text style={[Typography.amountS, {
                  color: lastPercent >= 0 ? c.brand.primaryOnSoft : c.semantic.negative,
                }]}>
                  {formatMoney(Math.max(0, split.amount), currency)}
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: 'flex-end' }}>
                {splitMode === 'percentage' && percentSub === 'same' && (
                  <Text style={[Typography.caption, { color: c.textTertiary }]}>
                    {roundPct(parseFloat(samePercent) || 0)}%
                  </Text>
                )}
                <Text style={[Typography.amountS, { color: c.text }]}>
                  {formatMoney(split.amount, currency)}
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {percentError && (
        <View style={[styles.errorRow, { backgroundColor: c.semantic.errorSoft, borderTopWidth: 1, borderTopColor: c.hair2 }]}>
          <Ionicons name="warning-outline" size={16} color={c.semantic.error} />
          <Text style={[Typography.bodyS, { color: c.semantic.error, flex: 1 }]}>
            {t('expense.percent_over_100')}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  percentBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
});
