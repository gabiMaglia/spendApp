import React from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';

interface TrustMarkProps {
  /** El aviso, **YA traducido**. Neutro, nunca acusatorio. */
  label: string;
  /** `sm` para las filas densas de una lista; `md` para el detalle. */
  size?: 'sm' | 'md';
  testID?: string;
}

/**
 * **La marca de T-041** (S10): «no se pudo verificar quién cargó esto».
 *
 * **Una sola marca, dos causas** (PO, 2026-08-31). «No se pudo verificar» y «la
 * firma no cierra» se actúan igual —mirar el gasto—, así que la UI no las
 * separa. La medición interna sí, siempre: son cuatro contadores distintos en
 * `recordHealth.ts` y eso no se negocia.
 *
 * **Nunca bloquea y nunca esconde.** El registro marcado se muestra como
 * cualquier otro y suma al balance igual (R1). Es la invariante de S6 y S7: si
 * algo dejó de verse o dejó de sumar por llevar marca, está mal.
 *
 * **El tono es una decisión del PO, no una preferencia de copy.** El borde de
 * ADR-004 —Apple manda `email` sólo en la primera autorización— hace que
 * registros LEGÍTIMOS no verifiquen. Un texto acusatorio acusaría a gente
 * honesta por una limitación nuestra. Por eso el componente no inventa ni una
 * palabra: **recibe el texto ya traducido** y lo dibuja. Un reusable que llama a
 * `t()` adentro obliga a que su test conozca las claves y deja de servir para el
 * segundo caso — está escrito en `ActionButton.tsx`.
 *
 * Las variantes viven acá adentro, nunca estiladas por pantalla.
 */
export function TrustMark({ label, size = 'md', testID }: TrustMarkProps) {
  const c = Colors[useColorScheme() ?? 'light'];
  const chico = size === 'sm';

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.marca,
        chico ? styles.sm : styles.md,
        { backgroundColor: c.surfaceSunken, borderColor: c.borderHair },
      ]}
    >
      <Ionicons
        name="help-circle-outline"
        size={chico ? 12 : 14}
        color={c.textTertiary}
      />
      <Text
        style={[chico ? Typography.caption : Typography.bodyS, { color: c.textSecondary }]}
        numberOfLines={chico ? 1 : 2}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    flexShrink: 1,
  },
  sm: { gap: 4, paddingHorizontal: 6, paddingVertical: 2 },
  md: { gap: 6, paddingHorizontal: 10, paddingVertical: 4 },
});
