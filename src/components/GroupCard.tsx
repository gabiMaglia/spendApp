import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from 'react-i18next';

interface GroupCardProps {
  name: string;
  memberIds: readonly string[];
  balance: number;
  currency?: CurrencyCode;
  subtitle?: string;
  onPress?: () => void;
  /** Última fila de la banda: sin divisor inferior. */
  last?: boolean;
  /** Chevron a la derecha (lista de la tab Grupos; en el home no va). */
  chevron?: boolean;
}

/**
 * Fila de grupo del reskin: ya NO es una tarjeta.
 *
 * Es una fila de banda (hairline inferior, sin radio ni sombra) con avatar
 * cuadrado de inicial, y a la derecha el tag de estado en uppercase sobre el
 * monto. El stack de avatares se fue: en una fila de 62pt competía con el monto
 * y el conteo de miembros ya lo dice el subtítulo.
 */
export function GroupCard({
  name, memberIds, balance, currency = 'ARS', subtitle, onPress, last, chevron,
}: GroupCardProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const settled  = balance === 0;
  const positive = balance > 0;
  const amountColor = settled ? c.textTertiary : positive ? c.semantic.positive : c.semantic.negative;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.hair2, borderBottomWidth: last ? 0 : 1 },
        pressed && { backgroundColor: c.bgGrouped },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: c.brand.primarySoft }]}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: c.brand.primary }}>
          {name.slice(0, 1).toUpperCase()}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>{name}</Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
          {t('groups.members_count', { count: memberIds.length })}
          {subtitle ? ` · ${subtitle}` : ''}
        </Text>
      </View>

      <View style={styles.balanceCol}>
        <Text style={[Typography.label, {
          color: c.textTertiary, textTransform: 'uppercase', fontSize: 9.5, marginBottom: 3,
        }]}>
          {settled
            ? t('common.settled')
            : positive ? t('dashboard.owes_you') : t('dashboard.you_owe_person')}
        </Text>
        <Text style={[Typography.amountS, { color: amountColor }]}>
          {formatMoney(Math.abs(balance), currency)}
        </Text>
      </View>

      {chevron && (
        <Text style={{ fontSize: 17, color: c.textTertiary, marginLeft: 2 }}>›</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Spacing.screenPad,
    paddingVertical: Spacing.rowPadV,
  },
  tile: {
    width: 38, height: 38, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0, marginRight: 8, gap: 2 },
  balanceCol: { alignItems: 'flex-end', flexShrink: 0, maxWidth: 130 },
});
