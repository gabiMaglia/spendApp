import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { BandRow } from '@/src/components/Band';
import { UserAvatar } from '@/src/components/UserAvatar';
import { formatMoney } from '@/src/constants/currencies';
import { useColors } from '@/src/skins/useSkin';

/**
 * Memoizada (PO 2026-09-22, rendimiento en gama baja): mismo patrón que
 * `GroupRow` en Grupos — sólo sirve porque `onRemove`/`onSettle` llegan como
 * referencias ESTABLES desde `FriendsScreen` (`useFriendsContacts`), no inline.
 */
export const ContactRow = React.memo(function ContactRow({
  userId, name, amount, currency, conHistorial, puedeSaldar, onRemove, onSettle, last,
}: {
  userId: string; name: string;
  amount?: number; currency: string;
  /** Si hubo gastos o saldados entre los dos. Sin historial, un saldo en cero no es «Saldado». */
  conHistorial: boolean;
  /** Si le debo algo (T-225): no depende del neto que muestra la fila. */
  puedeSaldar: boolean;
  onRemove: (id: string, name: string) => void;
  onSettle: (id: string) => void;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const hasBalance = amount !== undefined && amount !== 0;
  const positive   = (amount ?? 0) > 0;

  return (
    <BandRow last={last}>
      <UserAvatar userId={userId} name={name} size={42} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>{name}</Text>
        {hasBalance ? (
          <Text
            style={{
              fontSize: 11.5, fontWeight: '600',
              color: positive ? c.semantic.positive : c.semantic.negative,
            }}
            numberOfLines={1}
          >
            {positive ? t('friends.owes_you') : t('friends.you_owe_them')}
            {formatMoney(Math.abs(amount!), currency as any)}
          </Text>
        ) : conHistorial ? (
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.textTertiary }}>
            {t('common.settled')}
          </Text>
        ) : null}
      </View>
      {puedeSaldar && (
        <Pressable
          onPress={() => onSettle(userId)}
          style={[styles.actionChip, { backgroundColor: c.brand.primarySoft }]}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: c.brand.primary }}>
            {t('friends.settle')}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={() => onRemove(userId, name)} hitSlop={8}>
        <Ionicons name="trash-outline" size={16} color={c.textTertiary} />
      </Pressable>
    </BandRow>
  );
});

const styles = StyleSheet.create({
  actionChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: Radius.full },
});
