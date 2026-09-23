import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FondoMarmol } from '@/src/components/FondoMarmol';

/**
 * **Separador de temporalidad ("Hoy"/"Ayer"/"Antes") con mármol** (PO
 * 2026-09-22). Antes era un `SectionLabel` plano — mismo lenguaje que
 * `MovimientosHeader`/`ContactosCountHeader`: mármol de fondo, UN solo
 * borde —el de abajo—, sin borde arriba. Patrón "franja" (misma textura
 * angosta que ya usan el navegador de mes y el total de Grupos).
 */
/** Aire de arriba por defecto (no-primera sección) — igual al viejo `SectionLabel`. */
export const SECTION_HEADER_TOP = 22;

export function ActivitySectionHeader({
  label, topOverride, right,
}: { label: string; topOverride?: number; right?: React.ReactNode }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[
      styles.sectionHeader,
      { borderBottomColor: c.hair, paddingTop: topOverride ?? SECTION_HEADER_TOP },
    ]}>
      <FondoMarmol patron="franja" />
      <Text style={[Typography.label, styles.sectionHeaderBold, { color: c.textTertiary }]}>
        {label}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: Spacing.screenPad, paddingTop: SECTION_HEADER_TOP, paddingBottom: 9,
    borderBottomWidth: 1,
  },
  sectionHeaderBold: { fontWeight: '800' },
});
