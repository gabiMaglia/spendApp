import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band } from '@/src/components/Band';
import type { PersonalEntry } from '@/src/types/models';
import { EntryRow } from './EntryRow';

/** Lista de movimientos del mes — estado vacío, o las filas ordenadas. */
export function MovimientosList({
  entries, monthLabelText, onRemove,
}: {
  entries: PersonalEntry[];
  /** Ya formateado (`monthLabel(activeMonth)`) — este componente no sabe de meses. */
  monthLabelText: string;
  onRemove: (entry: PersonalEntry) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  if (entries.length === 0) {
    return (
      <Band noTop style={styles.grow}>
        <View style={styles.emptyBox}>
          <Ionicons name="receipt-outline" size={26} color={c.textTertiary} />
          <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8, textAlign: 'center' }]}>
            {t('personal.no_movements', { month: monthLabelText })}
          </Text>
        </View>
      </Band>
    );
  }

  return (
    // flexGrow (PO 2026-09-22): con pocos movimientos esta banda tiene que
    // estirarse hasta el borde inferior — si no, el blanco corta a mitad de
    // pantalla y queda fondo crema desnudo hasta la tab bar.
    <Band noTop style={styles.grow}>
      {entries.map((entry, i) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          last={i === entries.length - 1}
          onRemove={onRemove}
        />
      ))}
    </Band>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
});
