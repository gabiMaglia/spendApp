import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { MAX_TEXTO_CORTO } from '@/src/sync/nucleo/topes';
import { hapticSelection } from '@/src/utils/haptics';
import { useColors } from '@/src/skins/useSkin';
import type { PersonalCategory } from '@/src/types/models';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';

/**
 * Descripción: tarjeta propia, mismo lenguaje redondeado que el héroe — ya no
 * comparte línea con nada de arriba (T-117 quedó obsoleto con el rediseño
 * 2026-09-22). T-223: salió de `app/expense/new.tsx`.
 */
export function DescripcionCard({
  value, onChangeText, isIncome,
}: { value: string; onChangeText: (v: string) => void; isIncome: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.descCard, { borderColor: c.hair, backgroundColor: c.surface }]}>
      <Ionicons name="create-outline" size={18} color={c.textTertiary} />
      <TextInput
        placeholder={isIncome ? t('expense.income_desc_placeholder') : t('expense.description_placeholder')}
        placeholderTextColor={c.textTertiary}
        value={value}
        onChangeText={onChangeText}
        maxLength={MAX_TEXTO_CORTO}
        style={[Typography.bodyL, styles.descInput, { color: c.text }]}
        returnKeyType="next"
      />
    </View>
  );
}

/**
 * Tiles de categoría (rediseño 2026-09-22): ícono en círculo arriba, label
 * abajo. El ingreso no los muestra (PO 2026-09-13).
 */
export function CategoriaChips({
  value, onChange,
}: { value: PersonalCategory; onChange: (c: PersonalCategory) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // `flexGrow: 0` no es decorativo: el contenedor de la pantalla crece
      // para poder empujar Guardar al fondo, y un ScrollView horizontal sin
      // alto propio se come todo ese sobrante. Los tiles quedaban gigantes.
      style={styles.categoryScrollBox}
      contentContainerStyle={styles.categoryScroll}
    >
      {CATEGORIES.map(cat => {
        const active = value === cat.id;
        return (
          <Pressable
            key={cat.id}
            onPress={() => { hapticSelection(); onChange(cat.id); }}
            style={styles.categoryTile}
          >
            <View style={[
              styles.categoryTileIcon,
              { backgroundColor: active ? c.brand.primary : c.bgGrouped },
            ]}>
              <Ionicons name={cat.icon} size={22} color={active ? '#fff' : c.textSecondary} />
            </View>
            <Text
              numberOfLines={1}
              style={[Typography.caption, {
                color:      active ? c.text : c.textTertiary,
                fontWeight: active ? '700' : '500',
              }]}
            >
              {t(`categories.${cat.id}`)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  descCard: {
    marginHorizontal: Spacing.screenPad,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1,
    paddingHorizontal: Spacing[4], paddingVertical: 14,
  },
  descInput: { flex: 1, padding: 0, fontWeight: '500' },
  // El scroll no crece con el contenedor…
  categoryScrollBox: { flexGrow: 0 },
  // …y las pastillas se centran en vez de estirarse: en una fila, el
  // `alignItems` por defecto es `stretch`, así que sin esto toman el alto de lo
  // que las contenga. Mismo margen lateral que el resto (`screenPad`).
  categoryScroll: {
    gap: Spacing[2], paddingHorizontal: Spacing.screenPad, paddingVertical: 2,
    alignItems: 'center',
  },
  categoryTile: { alignItems: 'center', gap: 6, width: 64 },
  categoryTileIcon: {
    width: 52, height: 52, borderRadius: Radius.xl, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
});
