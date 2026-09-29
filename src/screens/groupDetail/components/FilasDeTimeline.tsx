import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { BandRow } from '@/src/components/Band';
import { TrustMark } from '@/src/components/TrustMark';
import { isMarked, type TrustState } from '@/src/algorithms/recordTrust';
import { mismaPersona } from '@/src/store/identityAlias';
import i18n from '@/src/i18n';
import { useColors } from '@/src/skins/useSkin';
import type { Expense, Payment } from '@/src/types/models';

/** Filas del historial del grupo. T-223: salieron de `app/groups/[id].tsx`. */

export function ExpenseRow({
  expense, currentUserId, getUserName, trust, last,
}: {
  expense: Expense;
  currentUserId: string;
  getUserName: (id: string) => string;
  trust?: TrustState;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();

  const myShare   = expense.splits.find(s => mismaPersona(s.userId, currentUserId));
  const isPayer   = mismaPersona(expense.paidById, currentUserId);
  const dateLabel = new Date(expense.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const netForMe  = isPayer
    ? expense.amount - (myShare?.amount ?? 0)
    : -(myShare?.amount ?? 0);

  return (
    <BandRow last={last} onPress={() => router.push(`/expense/${expense.id}` as any)}>
      <View style={[styles.rowIcon, { backgroundColor: c.hair2 }]}>
        <Ionicons name="receipt-outline" size={17} color={c.textTertiary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {expense.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
          {getUserName(expense.paidById)} · {dateLabel}
        </Text>
        {isMarked(trust ?? 'pendiente') && <TrustMark label={t('trust.badge')} size="sm" />}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[Typography.amountS, {
          color: netForMe > 0 ? c.semantic.positive : netForMe < 0 ? c.semantic.negative : c.textTertiary,
        }]}>
          {netForMe > 0 ? '+' : ''}{formatMoney(netForMe, expense.currency)}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {t('group_detail.total_suffix', { amount: formatMoney(expense.amount, expense.currency) })}
        </Text>
      </View>
    </BandRow>
  );
}

export function PaymentRow({
  payment, currentUserId, getUserName, trust, last,
}: {
  payment: Payment;
  currentUserId: string;
  getUserName: (id: string) => string;
  trust?: TrustState;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();

  const fromName  = mismaPersona(payment.fromUserId, currentUserId) ? t('common.you') : getUserName(payment.fromUserId);
  const toName    = mismaPersona(payment.toUserId, currentUserId)   ? t('common.you') : getUserName(payment.toUserId);
  const dateLabel = new Date(payment.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  // T-186: sin acuse, un saldado declarado cuenta al instante.
  return (
    <BandRow last={last}>
      <View style={[styles.rowIcon, { backgroundColor: c.semantic.positiveSoft }]}>
        <Ionicons name="checkmark-circle-outline" size={17} color={c.semantic.positive} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {t('group_detail.paid_to', { from: fromName, to: toName })}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {t('group_detail.payment_label')} · {dateLabel}
        </Text>
        {isMarked(trust ?? 'pendiente') && <TrustMark label={t('trust.badge')} size="sm" />}
      </View>
      <Text style={[Typography.amountS, { color: c.semantic.positive }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    </BandRow>
  );
}

const styles = StyleSheet.create({
  rowIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
