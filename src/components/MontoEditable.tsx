import React, { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
 *
 * **Área táctil de todo el bloque, no sólo de los dígitos** (PO 2026-09-22): el
 * `TextInput` sin `flex` mide lo que ocupa su contenido — con el placeholder
 * "0" eso es angosto, y todo el padding alrededor (pensado para que el monto
 * se vea grande y centrado) no respondía al toque. El `Pressable` que envuelve
 * todo enfoca el input por `ref`; el input en sí no se agranda, así que el
 * número sigue centrado como antes.
 */
export const MontoEditable = forwardRef<TextInput, {
  currency: CurrencyCode;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  /** Pinta la cifra en rojo (p. ej. monto por encima del tope). */
  error?: boolean;
  testID?: string;
}>(function MontoEditable({ currency, value, onChangeText, onBlur, error, testID }, ref) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      testID={testID ? `${testID}-tap-area` : undefined}
      style={styles.tapArea}
      onPress={() => (ref as React.RefObject<TextInput>)?.current?.focus()}
    >
      <View style={styles.fila} pointerEvents="none">
        <Text testID={testID ? `${testID}-simbolo` : undefined} style={[Typography.amountXL, styles.simbolo, { color: c.textTertiary }]}>
          {getCurrency(currency).symbol}
        </Text>
        <TextInput
          ref={ref}
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
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // Ancho completo: es lo que convierte todo el padding de alrededor (lo
  // pone la pantalla que lo usa) en zona táctil, no sólo los dígitos.
  tapArea: { width: '100%', alignItems: 'center' },
  fila:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  simbolo: { fontWeight: '400' },
  // Sin el relleno propio del TextInput de Android: es lo que corría el 0 hacia abajo.
  input:   { paddingVertical: 0, paddingHorizontal: 0, includeFontPadding: false, textAlignVertical: 'center' },
});
