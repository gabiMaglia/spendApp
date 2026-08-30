import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import type { Bucket } from '@/src/services/fxTotals';

/**
 * Avisa que el total mostrado está incompleto, y CUÁNTO falta.
 *
 * Existe por el invariante que ordena todo esto: **un número nunca puede
 * ocultar que hay plata que no se está mostrando**. Cuando no hay cotizaciones
 * —ni red ni cache— y el usuario tiene saldo en otras monedas, el total en su
 * moneda elegida es verdadero pero parcial. Sin este aviso, un total más chico
 * que la realidad es indistinguible de haber gastado menos.
 *
 * Muestra los montos en su moneda ORIGINAL, sin convertir: es justamente lo
 * que no se pudo hacer, y aproximarlo acá sería inventar el dato que falta.
 */
export function UnconvertedNotice({
  visible, display, unconverted, onClose,
}: {
  visible: boolean;
  display: CurrencyCode;
  unconverted: Bucket[];
  onClose: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  // Sin nada pendiente no hay nada que avisar: el total ya es completo.
  if (unconverted.length === 0) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <View style={styles.header}>
            <Ionicons name="alert-circle-outline" size={20} color={c.semantic.warning} />
            <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700', flex: 1 }]}>
              {t('fx.partial_title')}
            </Text>
          </View>

          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            {t('fx.partial_body', { currency: display })}
          </Text>

          <View style={[styles.list, { backgroundColor: c.surfaceSunken }]}>
            {unconverted.map(b => (
              <View key={b.currency} style={styles.item} testID={`unconverted-${b.currency}`}>
                <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
                  {b.currency}
                </Text>
                <Text style={[Typography.bodyM, { color: c.text, fontWeight: '700' }]}>
                  {formatMoney(b.minor, b.currency)}
                </Text>
              </View>
            ))}
          </View>

          <Text style={[Typography.caption, { color: c.textTertiary }]}>
            {t('fx.partial_hint')}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.cta, { backgroundColor: c.brand.primary }]}
          >
            <Text style={[Typography.bodyM, { color: '#FFFFFF', fontWeight: '700' }]}>
              {t('fx.close')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, justifyContent: 'center', padding: Spacing[5], backgroundColor: 'rgba(0,0,0,0.45)' },
  card:   { borderRadius: Radius.lg, padding: Spacing[5], gap: Spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  list:   { borderRadius: Radius.sm, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2] },
  item:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing[2] },
  cta:    { borderRadius: Radius.sm, paddingVertical: Spacing[3], alignItems: 'center' },
});
