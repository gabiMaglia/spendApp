import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FondoMarmol } from '@/src/components/FondoMarmol';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  return (
    <View testID="contactos-count-header" style={[styles.countHeader, { borderBottomColor: c.hair }]}>
      <FondoMarmol patron="distendida" />
      <Text style={[Typography.label, styles.countBold, { color: c.textTertiary }]}>
        {t('friends.contacts_count', { count })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  countHeader: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[8], paddingBottom: 9,
    borderBottomWidth: 1,
  },
  countBold: { fontWeight: '800' },
});
