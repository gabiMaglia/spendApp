import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/**
 * Sección del Detalle de gasto con su rótulo en mayúsculas.
 * T-223: salió de `app/expense/[id].tsx`, donde se repetía tres veces.
 */
export function SeccionDeGasto({ titulo, margenTitulo = 12, children }: {
  titulo: string;
  margenTitulo?: number;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.hair }]}>
      <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: margenTitulo }]}>
        {titulo}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Banda, no tarjeta: borde a borde, hairline arriba y abajo, sin radio.
  section:  {
    marginBottom: Spacing[4],
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[4],
  },
});
