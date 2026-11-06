import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, useC } from '@/src/components/band/BandBase';

/**
 * Sección del Detalle de gasto con su rótulo en mayúsculas.
 * T-223: salió de `app/expense/[id].tsx`, donde se repetía tres veces.
 *
 * Va sobre `Band` (PO 2026-11-06): en Clásico, banda borde a borde con
 * hairline arriba y abajo (igual que antes); en Aero, tarjeta suelta con su
 * margen lateral, como «Borrar gasto» (`FilaBorrarGasto`). Antes dibujaba la
 * banda a mano y en Aero quedaba pegada a los costados.
 */
export function SeccionDeGasto({ titulo, margenTitulo = 12, children }: {
  titulo: string;
  margenTitulo?: number;
  children: React.ReactNode;
}) {
  const c = useC();
  return (
    <Band style={styles.section}>
      <View testID="seccion-de-gasto" style={styles.cuerpo}>
        <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: margenTitulo }]}>
          {titulo}
        </Text>
        {children}
      </View>
    </Band>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: Spacing[4] },
  cuerpo:  { paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[4] },
});
