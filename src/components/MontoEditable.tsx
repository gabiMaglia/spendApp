import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { getCurrency, type CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * **El monto grande editable** de «Nuevo gasto» y «Registrar pago» (T-113).
 *
 * Estaba duplicado en las dos pantallas, con el signo `$` escrito a mano —mal para
 * cualquier moneda que no fuera peso— y desalineado del `0`: el signo tenía otra
 * altura de línea y el `TextInput` de Android suma su propio relleno vertical.
 *
 * El signo y la cifra comparten tamaño y altura de línea, y el input va sin relleno:
 * así quedan en la misma línea base en iOS y en Android. El signo sale de
 * `SUPPORTED_CURRENCIES`, nunca escrito a mano.
 */
export function MontoEditable({
  currency, value, onChangeText, onBlur, error, testID,
}: {
  currency: CurrencyCode;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  /** Pinta la cifra en rojo (p. ej. monto por encima del tope). */
  error?: boolean;
  testID?: string;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.fila}>
      <Text testID={testID ? `${testID}-simbolo` : undefined} style={[Typography.amountXL, styles.simbolo, { color: c.textTertiary }]}>
        {getCurrency(currency).symbol}
      </Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={c.textTertiary}
        style={[Typography.amountXL, styles.input, { color: error ? c.semantic.negative : c.text }]}
        returnKeyType="done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fila:    { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  simbolo: { fontWeight: '400' },
  // Sin el relleno propio del TextInput de Android: es lo que corría el 0 hacia abajo.
  input:   { paddingVertical: 0, paddingHorizontal: 0, includeFontPadding: false, textAlignVertical: 'center' },
});
