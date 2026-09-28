import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/**
 * Tarjeta cerrada del skin Clásico: etiqueta arriba, contenido debajo separado
 * por una línea, pie opcional (link o aclaración) al final.
 *
 * Extraída en T-210 (PO 2026-09-28): `RecurrencePicker` ya usaba este patrón
 * en solitario para "Repetir" (aprobado por el PO el 27/09); cuando Pago y
 * Reparto de `expense/new.tsx` lo necesitaron también, se volvió repetición
 * (regla del repo: al 2do uso, se extrae).
 *
 * Sólo para Clásico — quien llama decide con `useSkinTokens().flags.soft` si
 * renderiza esto o el layout suelto de Aero; el componente no mira el skin.
 */
export function TarjetaClasica({
  label, hint, children, testID,
}: {
  label: string;
  /** Pie de la tarjeta (link o aclaración), ya con su propio estilo (color, padding). */
  hint?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={[styles.card, { borderColor: c.hair, backgroundColor: c.surface }]}>
      <Text style={[Typography.label, styles.label, { color: c.textSecondary }]}>
        {label}
      </Text>
      <View style={[styles.content, { borderTopColor: c.hair }]}>
        {children}
      </View>
      {hint}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.screenPad,
    borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1,
    overflow: 'hidden',
  },
  label:   { paddingHorizontal: Spacing[4], paddingTop: 12, paddingBottom: 8 },
  content: { borderTopWidth: 1 },
});
