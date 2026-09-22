import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { BottomSheet } from '@/src/components/Sheet';
import { usePersonalStore } from '@/src/store/personalStore';
import { hapticLight, hapticSelection } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * **Configurar/editar el presupuesto mensual** (T-137).
 *
 * Antes vivía sólo dentro de Personal (armada la primera vez desde el estado
 * vacío, o reabierta con el engranaje del header). El engranaje del header
 * pasa a llevar siempre a «Yo» (mismo botón en las cuatro tabs) — la edición
 * del presupuesto ya establecido se mudó ahí, a su propia fila. La
 * configuración INICIAL (cuando todavía no hay presupuesto) sigue siendo el
 * estado vacío de Personal, que monta este mismo sheet.
 *
 * Estado propio, no global: lee `budget` de `usePersonalStore` recién al
 * abrirse (cada vez que `visible` pasa a `true`), así que dos aperturas
 * seguidas no arrastran un borrador viejo si el usuario cerró sin guardar.
 */
export function BudgetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const { budget, setBudget } = usePersonalStore();

  const [includeOwedToMe, setIncludeOwedToMe] = useState(budget.includeOwedToMe);
  const [budgetCurrency] = useState<CurrencyCode>(budget.currency);
  const {
    text: budgetInput,
    minor: budgetAmount,
    onChangeText: setBudgetInput,
    onBlur: onBudgetInputBlur,
  } = useAmountInput(budgetCurrency, budget.monthlyAmount);

  function handleSave() {
    setBudget({ currency: budgetCurrency, monthlyAmount: budgetAmount, includeOwedToMe });
    hapticLight();
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>{t('personal.budget_sheet_title')}</Text>
      <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
        {t('personal.budget_reset_note')}
      </Text>

      <Text style={[Typography.label, styles.upper, { color: c.textTertiary, marginBottom: 8 }]}>
        {t('personal.amount')}
      </Text>
      <View style={[styles.budgetInput, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
        <Text style={[Typography.bodyM, { color: c.textTertiary }]}>$</Text>
        <TextInput
          value={budgetInput}
          onChangeText={setBudgetInput}
          onBlur={onBudgetInputBlur}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={c.textTertiary}
          style={[Typography.bodyM, { flex: 1, color: c.text, padding: 0 }]}
          returnKeyType="done"
        />
      </View>

      <Pressable
        onPress={() => { hapticSelection(); setIncludeOwedToMe(v => !v); }}
        style={[styles.toggleRow, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[Typography.bodyL, { color: c.text }]}>{t('personal.include_owed')}</Text>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>{t('personal.include_owed_sub')}</Text>
        </View>
        <View style={[styles.toggle, { backgroundColor: includeOwedToMe ? c.brand.primary : c.hair }]}>
          <View style={[styles.toggleKnob, includeOwedToMe && styles.toggleKnobOn]} />
        </View>
      </Pressable>

      <Pressable testID="budget-save" onPress={handleSave} style={[styles.saveBtn, { backgroundColor: c.brand.primary }]}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('personal.save_budget')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
  budgetInput: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: Radius.md, borderWidth: 1, padding: 14,
  },
  toggle:      { width: 42, height: 25, borderRadius: 13, padding: 3 },
  toggleKnob:  { width: 19, height: 19, borderRadius: 10, backgroundColor: '#fff' },
  toggleKnobOn:{ transform: [{ translateX: 17 }] },
  // marginBottom (PO 2026-09-21): sin esto el botón quedaba pegado al borde
  // inferior de la hoja — el paddingBottom genérico de BottomSheet alcanza
  // para el resto del contenido, pero no para separar el último elemento.
  saveBtn:     { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 12 },
});
