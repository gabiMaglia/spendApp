import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { UserAvatar } from './UserAvatar';
import { formatMoney, minorFactor, parseMoney, type AppLang, type CurrencyCode } from '@/src/constants/currencies';
import { validatePayers } from '@/src/algorithms/payers';
import { MAX_MONTO_MENOR, sanitizeTypedAmount } from '@/src/hooks/sanitizeAmount';
import type { Payer } from '@/src/types/models';
import { useColors } from '@/src/skins/useSkin';

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
  const { t, i18n } = useTranslation();
  const lang: AppLang = i18n.language === 'en' || i18n.language === 'pt' ? i18n.language : 'es';
  const c = useColors();

  const amountOf = (userId: string) => value.find(p => p.userId === userId)?.amount ?? 0;
  const sum = value.reduce((total, p) => total + p.amount, 0);
  const difference = totalAmount - sum;

  const contributing = value.filter(p => p.amount > 0);
  const validation = validatePayers(contributing, totalAmount);

  // Texto que el usuario está tipeando por pagador: sin él, un decimal recién
  // tipeado («12,») se perdería al volver a derivar el texto del monto.
  const [textos, setTextos] = useState<Record<string, string>>({});

  const textoDe = (userId: string): string => {
    const amount = amountOf(userId);
    const tipeado = textos[userId];
    if (tipeado !== undefined && parseMoney(tipeado, currency, lang) === amount) return tipeado;
    return amount > 0 ? sanitizeTypedAmount(String(amount / minorFactor(currency)), currency, lang) : '';
  };

  function setAmount(userId: string, raw: string) {
    // Mismo pipeline que el monto principal (T-254): miles y ambos separadores.
    const texto = sanitizeTypedAmount(raw, currency, lang, textos[userId]);
    setTextos(prev => ({ ...prev, [userId]: texto }));
    // Un monto negativo no existe: cuenta como 0, no como su valor absoluto.
    const minor = /^\s*-/.test(raw) ? 0 : parseMoney(texto, currency, lang);

    const next = members.map(m => ({
      userId: m.id,
      amount: m.id === userId ? Math.min(Math.max(0, minor), MAX_MONTO_MENOR) : amountOf(m.id),
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
            value={textoDe(m.id)}
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
