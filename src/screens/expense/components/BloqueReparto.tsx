import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { Band, SectionLabel, Segmented } from '@/src/components/Band';
import { TarjetaClasica } from '@/src/components/TarjetaClasica';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';
import type { PercentSub, SplitCalculado, SplitMode } from '@/src/screens/expense/repartoDeGasto';
import { FilasDeReparto } from '@/src/screens/expense/components/FilasDeReparto';

/**
 * «Cómo se divide» — SOLO con grupo (F-G). Aero: selectores de borde a borde
 * y filas en `Band noTop`. Clásico (T-210, PO 2026-09-28): tarjeta cerrada
 * como Repetir/descripción, con `borde="ninguno"` en los `Segmented` (el marco
 * lo pone la tarjeta). T-223: salió de `app/expense/new.tsx`.
 */
export function BloqueReparto({
  splitMode, percentSub, samePercent, customPercents, splits, lastPercent, percentError, currency,
  onSplitModeChange, onPercentSubChange, onSamePercentChange, onCustomPercentsChange,
}: {
  splitMode: SplitMode;
  percentSub: PercentSub;
  samePercent: string;
  customPercents: string[];
  splits: SplitCalculado[];
  lastPercent: number;
  percentError: boolean;
  currency: CurrencyCode;
  onSplitModeChange: (m: SplitMode) => void;
  onPercentSubChange: (s: PercentSub) => void;
  onSamePercentChange: (v: string) => void;
  onCustomPercentsChange: (v: string[]) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const soft = useSkinTokens().flags.soft;

  const splitModeOptions: { key: SplitMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'equal',      label: t('expense.split_mode_equal'),      icon: 'people-outline' },
    { key: 'percentage', label: t('expense.split_mode_percentage'), icon: 'pie-chart-outline' },
  ];
  const percentSubOptions: { key: PercentSub; label: string }[] = [
    { key: 'same',   label: t('expense.percent_same') },
    { key: 'custom', label: t('expense.percent_custom') },
  ];

  const filas = (
    <FilasDeReparto
      splits={splits}
      splitMode={splitMode}
      percentSub={percentSub}
      samePercent={samePercent}
      customPercents={customPercents}
      onCustomPercentsChange={onCustomPercentsChange}
      lastPercent={lastPercent}
      percentError={percentError}
      currency={currency}
    />
  );

  // T-127 (PO): en «mismo %» el campo del porcentaje va DEBAJO de los nombres.
  const samePercentInput = splitMode === 'percentage' && percentSub === 'same' && (
    <View style={[styles.samePercentRow, styles.afterSelectorsGap]}>
      <View style={[styles.samePercentBox, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
        <TextInput
          value={samePercent}
          onChangeText={onSamePercentChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={c.textTertiary}
          style={[Typography.amountM, { color: c.text, minWidth: 50, textAlign: 'center' }]}
        />
        <Text style={[Typography.h3, { color: c.textSecondary }]}>%</Text>
      </View>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
        {t('expense.percent_same_hint')}
      </Text>
    </View>
  );

  if (soft) {
    return (
      <View>
        <SectionLabel label={t('expense.split_how')} />
        {/* Los dos selectores van PEGADOS, sin gap: la línea de abajo del
            primero es la única entre los dos (PO 2026-09-13). */}
        <Segmented
          variant="tabs"
          borde="ambos"
          value={splitMode}
          onChange={onSplitModeChange}
          options={splitModeOptions}
        />
        {splitMode === 'percentage' && (
          <Segmented
            variant="tabs"
            compact
            value={percentSub}
            onChange={onPercentSubChange}
            options={percentSubOptions}
          />
        )}
        {/* T-127 (PO): la lista de miembros va PEGADA al selector, compartiendo
            la línea divisoria; conserva su padding horizontal (PO 2026-09-13). */}
        <Band noTop>{filas}</Band>
        {samePercentInput}
      </View>
    );
  }

  return (
    <>
      <TarjetaClasica testID="tarjeta-reparto" label={t('expense.split_how')}>
        <View>
          <Segmented
            variant="tabs"
            borde="ninguno"
            value={splitMode}
            onChange={onSplitModeChange}
            options={splitModeOptions}
          />
          {splitMode === 'percentage' && (
            <Segmented
              variant="tabs"
              compact
              borde="ninguno"
              value={percentSub}
              onChange={onPercentSubChange}
              options={percentSubOptions}
            />
          )}
        </View>
        {/* Reemplaza el `Band noTop` de Aero: acá el fondo ya lo pone la tarjeta. */}
        <View style={[styles.cardMembersDivider, { borderTopColor: c.hair }]}>{filas}</View>
      </TarjetaClasica>
      {samePercentInput}
    </>
  );
}

const styles = StyleSheet.create({
  // Aire claro entre los selectores y lo que eligen (PO 2026-09-13).
  afterSelectorsGap: { marginTop: Spacing[3] },
  cardMembersDivider: { borderTopWidth: 1 },
  samePercentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: Spacing.screenPad, paddingBottom: 14,
  },
  samePercentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: Radius.lg, borderWidth: 1,
  },
});
