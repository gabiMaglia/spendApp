import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useSkinTokens } from '@/src/skins/useSkin';
import { Band, BandRow } from '@/src/components/Band';
import { Panel } from '@/src/components/skin/Panel';
import type { PersonalEntry } from '@/src/types/models';
import { limitarMovimientos } from '@/src/screens/personal/utils/limitarMovimientos';
import { EntryRow } from './EntryRow';

/** Lista de movimientos del mes — estado vacío, o las filas ordenadas. */
export function MovimientosList({
  entries, monthLabelText, onRemove, limite, onVerTodos,
}: {
  entries: PersonalEntry[];
  /** Ya formateado (`monthLabel(activeMonth)`) — este componente no sabe de meses. */
  monthLabelText: string;
  onRemove: (entry: PersonalEntry) => void;
  /** Tope de filas; sin él se pintan todas (pantalla «Ver todos»). */
  limite?: number;
  /** Si hay más que `limite`, la fila «Ver todos (N)» lo dispara. */
  onVerTodos?: () => void;
}) {
  const skin = useSkinTokens();
  const c = skin.colors;
  const { t } = useTranslation();
  const { visibles, total, hayMas } = limite === undefined
    ? { visibles: entries, total: entries.length, hayMas: false }
    : limitarMovimientos(entries, limite);
  const verTodos = hayMas && !!onVerTodos;

  if (entries.length === 0) {
    return (
      <Panel style={styles.grow}>
        <Band noTop style={styles.grow}>
          <View style={styles.emptyBox}>
            <Ionicons name="receipt-outline" size={26} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8, textAlign: 'center' }]}>
              {t('personal.no_movements', { month: monthLabelText })}
            </Text>
          </View>
        </Band>
      </Panel>
    );
  }

  return (
    // flexGrow (PO 2026-09-22): con pocos movimientos esta banda tiene que
    // estirarse hasta el borde inferior — si no, el blanco corta a mitad de
    // pantalla y queda fondo crema desnudo hasta la tab bar.
    <Panel style={styles.grow}>
      <Band noTop style={styles.grow}>
        {visibles.map((entry, i) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            last={!verTodos && i === visibles.length - 1}
            onRemove={onRemove}
          />
        ))}
        {verTodos && (
          <BandRow last onPress={onVerTodos} accessibilityRole="button" testID="movimientos-ver-todos">
            <Text style={[Typography.bodyM, { color: c.brand.primary, flex: 1 }]}>
              {t('personal.see_all', { count: total })}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={c.brand.primary} />
          </BandRow>
        )}
      </Band>
    </Panel>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
});
