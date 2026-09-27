import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { MarmolPill } from '@/src/components/skin/MarmolPill';
import { useSkinTokens } from '@/src/skins/useSkin';

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
  const skin = useSkinTokens();
  const c = skin.colors;
  // Aero (PO 2026-09-26): píldora de mármol con borde, igual que la de
  // Movimientos; el aire de arriba lo pone la píldora. Clásico: la franja de
  // siempre (MarmolPill no-soft = View + FondoMarmol).
  const extra = skin.flags.soft
    ? {
        paddingTop: skin.space.gapInline, paddingBottom: skin.space.gapInline,
        borderWidth: 1, borderColor: c.hair, borderTopColor: c.hair,
      }
    : { borderBottomWidth: 1, borderBottomColor: c.hair, paddingTop: topOverride ?? SECTION_HEADER_TOP };
  return (
    <MarmolPill patron="franja" style={[styles.sectionHeader, extra]}>
      <Text style={[Typography.label, styles.sectionHeaderBold, { color: c.textTertiary }]}>
        {label}
      </Text>
      {right}
    </MarmolPill>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: Spacing.screenPad, paddingTop: SECTION_HEADER_TOP, paddingBottom: 9,
  },
  sectionHeaderBold: { fontWeight: '800' },
});
