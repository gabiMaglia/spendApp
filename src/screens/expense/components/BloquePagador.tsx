import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { Band } from '@/src/components/Band';
import { TarjetaClasica } from '@/src/components/TarjetaClasica';
import { PayerSplitter } from '@/src/components/PayerSplitter';
import { UserAvatar } from '@/src/components/UserAvatar';
import { useUserStore } from '@/src/store/userStore';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';
import type { Payer } from '@/src/types/models';

/**
 * Quién pagó — SOLO con grupo (sin grupo = gasto personal, F-G). T-210 (PO
 * 2026-09-28): en Clásico es una `TarjetaClasica` con el link «pagaron
 * varios»/«uno solo» como PIE; en Aero, banda suelta con el link afuera, como
 * siempre. T-223: salió de `app/expense/new.tsx`.
 *
 * Devuelve un fragmento: el link suelto de Aero es un bloque más del scroll,
 * con el mismo aire entre bloques que el resto.
 */
export function BloquePagador({
  members, payerId, multiPayer, payers, amount, currency, onPayersChange, onOpenPayer, onTogglePayerMode,
}: {
  members: string[];
  payerId: string;
  multiPayer: boolean;
  payers: Payer[];
  amount: number;
  currency: CurrencyCode;
  onPayersChange: (p: Payer[]) => void;
  onOpenPayer: () => void;
  onTogglePayerMode: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const soft = useSkinTokens().flags.soft;
  const getUserName = useUserStore(s => s.getUserName);
  const payerName = getUserName(payerId);

  const splitter = (
    <PayerSplitter
      members={members.map(uid => ({ id: uid, name: getUserName(uid) }))}
      value={payers}
      totalAmount={amount}
      currency={currency}
      onChange={onPayersChange}
    />
  );

  const filaPagador = (
    <Pressable onPress={onOpenPayer} style={styles.row}>
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>{t('expense.payer_label')}</Text>
      <View style={styles.rowRight}>
        <UserAvatar userId={payerId} name={payerName} size={24} />
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>{payerName}</Text>
        <Ionicons name="chevron-down" size={16} color={c.textTertiary} />
      </View>
    </Pressable>
  );

  if (!soft) {
    return (
      <TarjetaClasica
        testID="tarjeta-pago"
        label={t('expense.payer_label')}
        hint={
          <Pressable onPress={onTogglePayerMode} hitSlop={8} style={styles.cardHintLink}>
            <Text style={[Typography.bodyS, { color: c.brand.primary }]}>
              {t(multiPayer ? 'payers.single' : 'payers.multiple')}
            </Text>
          </Pressable>
        }
      >
        {multiPayer ? <View style={styles.columna}>{splitter}</View> : filaPagador}
      </TarjetaClasica>
    );
  }

  if (multiPayer) {
    return (
      <Band>
        <View style={styles.columna}>
          {splitter}
          <Pressable onPress={onTogglePayerMode} hitSlop={8}>
            <Text style={[Typography.bodyS, { color: c.brand.primary }]}>{t('payers.single')}</Text>
          </Pressable>
        </View>
      </Band>
    );
  }

  return (
    <>
      <Band>{filaPagador}</Band>
      <Pressable onPress={onTogglePayerMode} hitSlop={8} style={styles.inlineLink}>
        <Text style={[Typography.bodyS, { color: c.brand.primary }]}>{t('payers.multiple')}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 15,
  },
  // Igual que `row` pero en columna (el splitter de varios pagadores).
  columna: {
    flexDirection: 'column', alignItems: 'stretch', justifyContent: 'space-between', gap: Spacing[2],
    paddingHorizontal: Spacing.screenPad, paddingVertical: 15,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Pie de `TarjetaClasica` (T-210): mismo padding que `cardHint` de
  // `RecurrencePicker`, para que las tres tarjetas midan igual.
  cardHintLink: { alignSelf: 'flex-start', paddingHorizontal: Spacing[4], paddingVertical: 10 },
  inlineLink: { alignSelf: 'flex-start', paddingHorizontal: Spacing.screenPad, paddingTop: 10 },
});
