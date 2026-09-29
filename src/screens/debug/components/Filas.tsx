import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';

/**
 * Piezas sueltas de la pantalla de Diagnóstico (`app/debug/identity.tsx`).
 * T-223: salieron de ahí para que cada bloque pueda vivir en su archivo.
 * `c` sigue siendo `any` como en el original: esto es sólo mudanza.
 */
export function Block({ title, c, children }: { title: string; c: any; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing[2] }}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ label, value, c, warn }: { label: string; value: string; c: any; warn?: boolean }) {
  return (
    <View style={estilosDiagnostico.row}>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{label}</Text>
      <Text
        selectable
        style={[Typography.bodyS, styles.value, { color: warn ? c.semantic.negative : c.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Tarjeta de aviso con borde y título del mismo color; el cuerpo va de hijos. */
export function Aviso({ color, titulo, children }: { color: string; titulo: string; children: React.ReactNode }) {
  return (
    <View style={[estilosDiagnostico.card, { borderColor: color }]}>
      <Text style={[Typography.bodyM, { color, fontWeight: '600' }]}>{titulo}</Text>
      {children}
    </View>
  );
}

export const estilosDiagnostico = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[3], gap: 4 },
  row:  { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[3] },
});

const styles = StyleSheet.create({
  value: { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
});
