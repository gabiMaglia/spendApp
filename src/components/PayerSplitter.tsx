import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserAvatar } from './UserAvatar';
import { formatMoney, minorFactor, type CurrencyCode } from '@/src/constants/currencies';
import { validatePayers } from '@/src/algorithms/payers';
import type { Payer } from '@/src/types/models';

export type PayerSplitterProps = {
  members: Array<{ id: string; name: string }>;
  /** Monto de cada uno, en menor unidad. Los que no pusieron van en 0. */
  value: Payer[];
  totalAmount: number;
  currency: CurrencyCode;
  onChange: (payers: Payer[]) => void;
};

/**
 * Reparto de quién puso cuánto en un gasto pagado entre varios.
 *
 * Muestra siempre la diferencia contra el total: en enteros de menor unidad la
 * suma tiene que dar EXACTO (ADR-002), así que el usuario necesita ver cuánto
 * le falta o le sobra mientras escribe, no descubrirlo al guardar.
 */
export function PayerSplitter({
  members, value, totalAmount, currency, onChange,
}: PayerSplitterProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const amountOf = (userId: string) => value.find(p => p.userId === userId)?.amount ?? 0;
  const sum = value.reduce((total, p) => total + p.amount, 0);
  const difference = totalAmount - sum;

  const contributing = value.filter(p => p.amount > 0);
  const validation = validatePayers(contributing, totalAmount);

  function setAmount(userId: string, text: string) {
    // El input es en unidades reales; el modelo guarda menor unidad.
    const real = parseFloat(text.replace(',', '.'));
    const minor = Number.isFinite(real) ? Math.round(real * minorFactor(currency)) : 0;

    const next = members.map(m => ({
      userId: m.id,
      amount: m.id === userId ? Math.max(0, minor) : amountOf(m.id),
    }));
    onChange(next);
  }

  return (
    <View style={styles.wrap}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>
        {t('payers.title')}
      </Text>

      {members.map(m => (
        <View key={m.id} style={styles.row}>
          <UserAvatar userId={m.id} name={m.name} size={28} />
          <Text style={[Typography.bodyM, styles.name, { color: c.text }]} numberOfLines={1}>
            {m.name}
          </Text>
          <TextInput
            accessibilityLabel={t('payers.amount_for', { name: m.name })}
            keyboardType="decimal-pad"
            value={amountOf(m.id) > 0 ? String(amountOf(m.id) / minorFactor(currency)) : ''}
            onChangeText={text => setAmount(m.id, text)}
            placeholder="0"
            placeholderTextColor={c.textTertiary}
            style={[
              Typography.bodyM, styles.input,
              { color: c.text, backgroundColor: c.surface, borderColor: c.borderHair },
            ]}
          />
        </View>
      ))}

      <Text
        accessibilityLabel={t('payers.difference')}
        style={[
          Typography.bodyS,
          { color: validation.ok ? c.semantic.positive : c.semantic.negative },
        ]}
      >
        {validation.ok
          ? t('payers.balanced')
          : difference > 0
            ? t('payers.missing', { amount: formatMoney(difference, currency) })
            : t('payers.over', { amount: formatMoney(-difference, currency) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { gap: Spacing[2] },
  row:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  name:  { flex: 1 },
  input: {
    width: 110,
    textAlign: 'right',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
  },
});
