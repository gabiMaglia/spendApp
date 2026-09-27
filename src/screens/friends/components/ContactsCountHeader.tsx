import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { MarmolPill } from '@/src/components/skin/MarmolPill';
import { useSkinTokens } from '@/src/skins/useSkin';

/**
 * **La fila "Contactos (N)" — chip con mármol** (PO 2026-09-22, corrige el
 * primer intento: el mármol NO va en "te deben/debés", que usa su
 * `SplitStat` de banda de siempre).
 *
 * Mismo lenguaje que `MovimientosHeader` de Personal: mármol de fondo, UN
 * solo borde —el de abajo—, sin borde arriba. Usa el patrón "distendido"
 * (más espaciado y tenue) para no repetir la foto exacta del header/Movimientos.
 */
export function ContactsCountHeader({ count }: { count: number }) {
  const skin = useSkinTokens();
  const c = skin.colors;
  const { t } = useTranslation();
  // Aero: píldora con borde, como Movimientos. Clásico: la franja de siempre.
  const extra = skin.flags.soft
    ? {
        paddingTop: skin.space.gapInline, paddingBottom: skin.space.gapInline,
        borderWidth: 1, borderColor: c.hair, borderTopColor: c.hair,
      }
    : { paddingTop: Spacing[8], borderBottomWidth: 1, borderBottomColor: c.hair };
  return (
    <MarmolPill testID="contactos-count-header" patron="distendida" style={[styles.countHeader, extra]}>
      <Text style={[Typography.label, styles.countBold, { color: c.textTertiary }]}>
        {t('friends.contacts_count', { count })}
      </Text>
    </MarmolPill>
  );
}

const styles = StyleSheet.create({
  countHeader: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.screenPad, paddingBottom: 9,
  },
  countBold: { fontWeight: '800' },
});
