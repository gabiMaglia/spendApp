import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { MontoEditable } from '@/src/components/MontoEditable';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useColors } from '@/src/skins/useSkin';

/**
 * Tarjeta héroe del monto (PO 2026-09-22, rediseño): el monto pasa a ser lo
 * primero que se ve, grande y con mármol de fondo. El toggle Gasto/Ingreso es
 * una píldora propia (no `Segmented`, a propósito: es una decisión de "qué
 * tipo de movimiento es", distinta de un tab de contenido —
 * `pestanasUnificadas.test.ts` sólo exige que los `Segmented` que SÍ existan
 * sean `variant="tabs"`). T-223: salió de `app/expense/new.tsx`.
 */
export function HeroMonto({
  currency, value, onChangeText, onBlur, incomeAllowed, isIncome, onKindChange,
}: {
  currency: CurrencyCode;
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  incomeAllowed: boolean;
  isIncome: boolean;
  onKindChange: (k: 'expense' | 'income') => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  // Área táctil de todo el bloque del monto, no sólo los dígitos (PO 2026-09-22).
  const montoRef = useRef<TextInput>(null);

  return (
    <View style={[styles.heroCard, { borderColor: c.hair, backgroundColor: c.surface }]}>
      <FondoMarmol patron="distendida" style={styles.heroMarmol} />
      <Text style={[Typography.label, styles.heroCurrency, {
        color: c.textSecondary,
        textShadowColor: scheme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.95)',
      }]}>
        {currency}
      </Text>
      <MontoEditable
        ref={montoRef}
        testID="expense-amount"
        sobreMarmol
        currency={currency}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
      />
      {incomeAllowed && (
        <View style={[styles.heroToggle, { backgroundColor: c.bgGrouped }]}>
          {(['expense', 'income'] as const).map(k => {
            const active = k === 'income' ? isIncome : !isIncome;
            const tint = k === 'income' ? c.semantic.positive : c.semantic.negative;
            const tintSoft = k === 'income' ? c.semantic.positiveSoft : c.semantic.negativeSoft;
            return (
              <Pressable
                key={k}
                onPress={() => onKindChange(k)}
                style={[styles.heroToggleBtn, active && { backgroundColor: tintSoft }]}
              >
                <Ionicons
                  name={k === 'income' ? 'trending-up-outline' : 'trending-down-outline'}
                  size={15}
                  color={active ? tint : c.textTertiary}
                />
                <Text style={[Typography.bodyS, { fontWeight: '700', color: active ? tint : c.textTertiary }]}>
                  {k === 'income' ? t('expense.kind_income') : t('expense.kind_expense')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Redondeada, con el mármol de fondo recortado por `overflow:hidden` y el
  // toggle Gasto/Ingreso abajo.
  heroCard: {
    marginHorizontal: Spacing.screenPad,
    borderRadius: Radius['2xl'], borderCurve: 'continuous', borderWidth: 1,
    alignItems: 'center', overflow: 'hidden',
    // Mismo paddingHorizontal que el resto de la card (U5, lote UI 2026-09-28):
    // sin esto `MontoEditable` (ancho 100%) llegaba a tocar el borde redondeado.
    paddingHorizontal: Spacing.screenPad,
    paddingTop: Spacing[6], paddingBottom: Spacing[4], gap: Spacing[3],
  },
  // El mármol «distendido» funde al color de fondo en su 38% inferior
  // (`scripts/generar-marmol-distendido.py`, fade_start 0.62). Se dibuja un
  // 62% más alto y el `overflow:hidden` de la tarjeta recorta el fundido: la
  // textura cubre todo (PO 2026-09-27).
  heroMarmol: { top: 0, bottom: undefined, height: '162%' },
  heroCurrency: {
    textTransform: 'uppercase', fontWeight: '800',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  heroToggle: {
    flexDirection: 'row', borderRadius: Radius.full, padding: 3, gap: 3,
  },
  heroToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full,
  },
});
