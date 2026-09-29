import React, { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '@/src/components/ActionButton';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { MontoEditable } from '@/src/components/MontoEditable';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useColors } from '@/src/skins/useSkin';

/**
 * Tarjeta héroe del monto a saldar, con lo pendiente, el atajo MAX y los
 * avisos de tope. T-223: salió de `app/settle/new.tsx`.
 */
export function HeroSaldo({
  currency, value, onChangeText, onBlur, exceedsMax, deudaTotal, todoSaldado, maxAmount, onMax,
}: {
  currency: CurrencyCode;
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  exceedsMax: boolean;
  deudaTotal: number;
  todoSaldado: boolean;
  maxAmount: number | undefined;
  onMax: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  // Área táctil de todo el bloque del monto, no sólo los dígitos (PO 2026-09-22).
  const montoRef = useRef<TextInput>(null);

  return (
    <View style={[
      styles.heroCard,
      { backgroundColor: c.surface, borderColor: exceedsMax ? c.semantic.negative : c.hair },
    ]}>
      <FondoMarmol patron="distendida" style={styles.heroMarmol} />
      <Text style={[Typography.label, styles.heroCurrency, {
        color: c.textSecondary,
        textShadowColor: scheme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.95)',
      }]}>
        {currency}
      </Text>
      <View style={styles.amountRow}>
        <View style={styles.amountGroup}>
          <MontoEditable
            ref={montoRef}
            testID="settle-amount"
            sobreMarmol
            currency={currency}
            value={value}
            onChangeText={onChangeText}
            onBlur={onBlur}
            error={exceedsMax}
          />
        </View>
        {deudaTotal > 0 && (
          <ActionButton
            testID="settle-max"
            size="sm"
            variant="plain"
            label={t('settle.max')}
            accessibilityLabel={t('settle.max_a11y')}
            action={onMax}
          />
        )}
      </View>
      {/* Sólo la deuda pendiente: el atajo MAX volvió arriba, al lado del
          número que va a escribir (pedido del PO). Lo que lo había echado
          de ahí era que se cortaba en pantallas angostas — la fila se
          encogía al contenido dentro de una tarjeta centrada. Eso ahora
          no puede pasar: la fila es `stretch` y el que cede ancho es el
          monto (`flexShrink: 1`), nunca el botón. */}
      {deudaTotal > 0 && (
        <View style={styles.outstandingRow}>
          <View testID="settle-outstanding" style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
              {t('settle.outstanding_label')}
            </Text>
            {/* El monto va FUERA del string traducido: dentro, ninguna
                prueba puede verlo sin conocer la clave, y el número queda
                a merced de cómo esté redactada cada traducción. */}
            <Text style={[Typography.bodyS, { color: c.textSecondary, fontWeight: '700' }]} numberOfLines={1}>
              {formatMoney(deudaTotal, currency)}
            </Text>
          </View>
        </View>
      )}

      {todoSaldado && (
        <View style={[styles.wholeDebt, { backgroundColor: c.semantic.positiveSoft, borderColor: 'transparent' }]}>
          <Ionicons name="checkmark-circle" size={14} color={c.semantic.positiveOnSoft} />
          <Text style={[Typography.bodyS, { color: c.semantic.positiveOnSoft, fontWeight: '600' }]}>
            {t('settle.all_settled')}
          </Text>
        </View>
      )}


      {maxAmount !== undefined && (
        <View style={[styles.maxHint, { backgroundColor: exceedsMax ? c.semantic.negativeSoft : c.bgGrouped }]}>
          <Ionicons
            name={exceedsMax ? 'warning-outline' : 'information-circle-outline'}
            size={13}
            color={exceedsMax ? c.semantic.negative : c.textTertiary}
          />
          <Text style={[Typography.caption, { color: exceedsMax ? c.semantic.negative : c.textTertiary }]}>
            {exceedsMax
              ? t('settle.max_exceeded', { amount: formatMoney(maxAmount, currency) })
              : t('settle.pending_balance', { amount: formatMoney(maxAmount, currency) })
            }
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wholeDebt: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: Spacing[3],
    paddingVertical: Spacing[2], paddingHorizontal: Spacing[3],
    borderRadius: Radius.full, borderWidth: 1,
  },
  // Mismo lenguaje que la tarjeta héroe de «Nuevo gasto» (PO 2026-09-23):
  // redondeada, mármol de fondo a todo el alto, monto grande arriba.
  heroCard: {
    borderRadius: Radius['2xl'], borderCurve: 'continuous', borderWidth: 1,
    overflow: 'hidden', paddingVertical: Spacing[6], alignItems: 'center', gap: 4,
  },
  heroMarmol:     { top: 0, bottom: 0 },
  heroCurrency:   {
    textTransform: 'uppercase', fontWeight: '800',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  // `stretch` + `center`: la fila ocupa todo el ancho de la tarjeta y centra su
  // contenido, en vez de encogerse a él. Es lo que impide que MAX se salga por
  // el borde cuando el monto es largo — antes la fila crecía con el número.
  amountRow:      {
    alignSelf: 'stretch', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: Spacing[4], paddingHorizontal: Spacing[4],
  },
  // El monto es el que cede ancho si no entra todo; MAX no se toca.
  amountGroup:    { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  // Ancho completo dentro de una tarjeta centrada: sin `alignSelf: stretch` la
  // fila se encoge al contenido y el botón se sale del borde.
  outstandingRow: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
    paddingHorizontal: Spacing[4], marginTop: 8,
  },
  maxHint:        {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, marginTop: 4,
  },
});
