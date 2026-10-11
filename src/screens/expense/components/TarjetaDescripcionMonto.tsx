import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { getCurrency, type CurrencyCode } from '@/src/constants/currencies';
import { MAX_TEXTO_CORTO } from '@/src/sync/nucleo/topes';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';
import type { PersonalCategory } from '@/src/types/models';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';

/**
 * Los dos renglones de Splitwise en una tarjeta (feat/reskin, B4): ícono de
 * la categoría al lado de la descripción, y la moneda al lado del monto. En
 * ingreso el ícono es el de ingreso, en verde.
 */
export function TarjetaDescripcionMonto({
  category, isIncome, currency, description, onDescriptionChange, amount, onAmountChange, onAmountBlur,
}: {
  category: PersonalCategory;
  isIncome: boolean;
  currency: CurrencyCode;
  description: string;
  onDescriptionChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  onAmountBlur: () => void;
}) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const c = skin.colors;
  const montoRef = useRef<TextInput>(null);

  const tinte = isIncome ? c.semantic.positive : tinteDeCategoria(c.category, category);
  const icono = isIncome ? 'trending-up-outline' : CATEGORIES.find(x => x.id === category)?.icon ?? 'ellipsis-horizontal-outline';

  return (
    <View style={[styles.tarjeta, { backgroundColor: c.surface, borderRadius: skin.radius.panel, boxShadow: skin.elevation.e2.boxShadow }]}>
      <View style={styles.renglon}>
        <View style={[styles.tile, { backgroundColor: conAlfa(tinte, 0.16) }]}>
          <Ionicons name={icono} size={28} color={tinte} />
        </View>
        <View style={styles.campo}>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('expense.description_label')}</Text>
          <TextInput
            placeholder={isIncome ? t('expense.income_desc_placeholder') : t('expense.description_placeholder')}
            placeholderTextColor={c.textTertiary}
            value={description}
            onChangeText={onDescriptionChange}
            maxLength={MAX_TEXTO_CORTO}
            returnKeyType="next"
            onSubmitEditing={() => montoRef.current?.focus()}
            style={[styles.descripcion, { color: c.text, borderBottomColor: c.brand.primary }]}
          />
        </View>
      </View>

      <Pressable style={styles.renglon} onPress={() => montoRef.current?.focus()}>
        <View style={[styles.tile, { backgroundColor: c.surfaceSunken }]}>
          <Text style={[styles.simbolo, { color: isIncome ? c.semantic.positive : c.brand.primary }]}>
            {getCurrency(currency).symbol}
          </Text>
          <Text style={[styles.codigo, { color: c.textTertiary }]}>{currency}</Text>
        </View>
        <View style={styles.campo} pointerEvents="box-none">
          <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('expense.amount_label')}</Text>
          <TextInput
            ref={montoRef}
            testID="expense-amount"
            value={amount}
            onChangeText={onAmountChange}
            onBlur={onAmountBlur}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={c.textDisabled}
            returnKeyType="done"
            style={[Typography.amountXL, styles.monto, {
              color: isIncome ? c.semantic.positive : c.text, borderBottomColor: c.hair,
            }]}
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    marginHorizontal: Spacing.screenPad, borderCurve: 'continuous',
    paddingHorizontal: 20, paddingVertical: 22, gap: 20,
  },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  tile: {
    width: 60, height: 60, borderRadius: 18, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
  campo: { flex: 1, gap: 2 },
  descripcion: {
    fontSize: 20, fontWeight: '500', paddingTop: 6, paddingBottom: 8, paddingHorizontal: 0,
    borderBottomWidth: 2,
  },
  simbolo: { fontSize: 22, lineHeight: 24, fontWeight: '700' },
  codigo: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  // Sin el relleno propio del TextInput de Android (ver `MontoEditable`).
  monto: {
    paddingTop: 0, paddingBottom: 6, paddingHorizontal: 0, includeFontPadding: false,
    borderBottomWidth: 1,
  },
});
