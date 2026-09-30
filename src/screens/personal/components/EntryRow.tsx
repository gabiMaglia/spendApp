import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { useSkinTokens } from '@/src/skins/useSkin';
import { BandRow } from '@/src/components/Band';
import { formatMoney } from '@/src/constants/currencies';
import type { PersonalEntry } from '@/src/types/models';
import { isEditable } from '@/src/algorithms/entryOrigin';
import { useUserStore } from '@/src/store/userStore';
import i18n from '@/src/i18n';

const ENTRY_KIND_META = {
  expense:         { icon: 'trending-down-outline' as const, labelKey: 'personal.kind_expense' },
  income:          { icon: 'trending-up-outline'   as const, labelKey: 'personal.kind_income' },
  group_replicated:{ icon: 'people-outline'        as const, labelKey: 'personal.kind_group' },
  carryover:       { icon: 'refresh-outline'       as const, labelKey: 'personal.kind_carryover' },
  payment_out:     { icon: 'arrow-up-circle-outline'   as const, labelKey: 'personal.kind_payment_out' },
  payment_in:      { icon: 'arrow-down-circle-outline' as const, labelKey: 'personal.kind_payment_in' },
};

/**
 * Memoizada (PO 2026-09-22, rendimiento en gama baja): sólo sirve porque
 * `onRemove` llega estable desde `PersonalScreen` (`useRemoveEntry`), no inline.
 */
export const EntryRow = React.memo(function EntryRow({
  entry, onRemove, last,
}: { entry: PersonalEntry; onRemove: (entry: PersonalEntry) => void; last?: boolean }) {
  const skin = useSkinTokens();
  const { t } = useTranslation();
  const c = skin.colors;
  const meta = ENTRY_KIND_META[entry.kind];
  const isCarryover = entry.kind === 'carryover';
  const isPositive  = entry.kind === 'income' || entry.kind === 'payment_in'
    || (isCarryover && entry.isPositiveCarryover === true);
  const isReadOnly  = !isEditable(entry);
  // T-229: los pagos se nombran por la contraparte, que no se guarda como texto.
  const nombre = useUserStore(s => (entry.counterpartId ? s.getUserName(entry.counterpartId) : ''));
  const dateLabel   = new Date(entry.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  // T-137: el ÍCONO es acción/categoría, no un monto — va en azul de marca
  // (mismo criterio que el FAB secundario de Ingreso). El monto en sí
  // (`amountColor`, abajo) sigue en verde/naranja: eso sí es dinero.
  const iconBg    = isPositive ? c.brand.primarySoft : c.hair2;
  const iconColor = isPositive ? c.brand.primary : c.textTertiary;
  const amountColor = isPositive ? c.semantic.positive
    : isCarryover ? c.semantic.negative : c.text;

  return (
    <BandRow last={last}>
      <View style={[styles.entryIcon, { backgroundColor: iconBg, borderRadius: skin.radius.chip }]}>
        <Ionicons name={meta.icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {entry.kind === 'payment_out' ? t('personal.payment_out_to', { name: nombre })
            : entry.kind === 'payment_in' ? t('personal.payment_in_from', { name: nombre })
            : entry.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
          {t(meta.labelKey)}
          {entry.sourceGroupName ? ` · ${entry.sourceGroupName}` : ''}
          {' · '}{dateLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={[Typography.amountS, { color: amountColor }]}>
          {isPositive ? '+' : '-'}{formatMoney(entry.amount, entry.currency)}
        </Text>
        {isReadOnly
          ? <Ionicons name="lock-closed-outline" size={12} color={c.textTertiary} />
          : (
            <Pressable onPress={() => onRemove(entry)} hitSlop={8}>
              <Ionicons name="trash-outline" size={14} color={c.textTertiary} />
            </Pressable>
          )}
      </View>
    </BandRow>
  );
});

const styles = StyleSheet.create({
  entryIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
