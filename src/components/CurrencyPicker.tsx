import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/src/constants/currencies';
import { BottomSheet, SheetOption } from './Sheet';

/**
 * Elige la moneda en la que el usuario ve sus totales, y le dice DE CUÁNDO son
 * las cotizaciones con las que se calcularon.
 *
 * La fecha no es decoración: un total convertido parece exacto, y con monedas
 * que se mueven rápido una tasa de hace días da un número que parece confiable
 * y no lo es. Mostrarla es lo que permite al usuario desconfiar cuando debe.
 *
 * Son 9 monedas: no entran en un segmentado como el de idioma (3), así que va
 * fila + hoja inferior, el mismo patrón que ya usa el resto de la app.
 */
export function CurrencyPicker({
  value, onChange, ratesFetchedAt, ratesNeeded, locale,
}: {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  /** ms de la última cotización bajada. `null` = nunca se bajó ninguna. */
  ratesFetchedAt: number | null;
  /** false cuando el usuario tiene una sola moneda: no se pide nada. */
  ratesNeeded: boolean;
  locale: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(false);

  const actual = SUPPORTED_CURRENCIES.find(x => x.code === value);

  // Sin más de una moneda no hay nada que cotizar: decirlo es más honesto que
  // mostrar "sin cotización todavía", que se leería como una falla.
  const pie = !ratesNeeded
    ? t('profile.rates_single')
    : ratesFetchedAt === null
      ? t('profile.rates_never')
      : t('profile.rates_updated', {
          date: new Date(ratesFetchedAt).toLocaleDateString(locale, {
            day: 'numeric', month: 'short',
          }),
        });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.display_currency')}
        onPress={() => setAbierto(true)}
        style={[styles.row, { backgroundColor: c.surface }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
            {t('profile.display_currency')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{pie}</Text>
        </View>
        <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '700' }]}>
          {actual ? `${actual.symbol} ${actual.code}` : value}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
      </Pressable>

      <CurrencySheet
        visible={abierto}
        value={value}
        onChange={onChange}
        onClose={() => setAbierto(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[2],
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[4],
    borderRadius: Radius.md,
  },
});

/**
 * Sólo la hoja de selección, sin la fila.
 *
 * Vive aparte porque la usan dos entradas distintas: la fila del menú (Perfil →
 * MONEDA) y el botón redondo del encabezado del dashboard. Duplicar las nueve
 * opciones en dos lugares garantiza que algún día difieran.
 */
export function CurrencySheet({
  visible, value, onChange, onClose,
}: {
  visible: boolean;
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {SUPPORTED_CURRENCIES.map(m => (
        <SheetOption
          key={m.code}
          icon="cash-outline"
          label={`${m.symbol}  ${m.code}`}
          sublabel={m.name}
          selected={m.code === value}
          onPress={() => { onChange(m.code); onClose(); }}
        />
      ))}
    </BottomSheet>
  );
}
