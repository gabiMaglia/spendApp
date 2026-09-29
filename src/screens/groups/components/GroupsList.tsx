import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band } from '@/src/components/Band';
import { SwipeToArchive } from '@/src/components/SwipeToArchive';
import type { Group } from '@/src/types/models';
import type { GroupsTab } from '@/src/screens/groups/hooks/useGroupsList';
import { GroupRow } from './GroupRow';
import { useColors } from '@/src/skins/useSkin';

export type GroupsFlatItem = { kind: 'group'; id: string; group: Group; isLast: boolean };

/** Aplana la lista de grupos en ítems planos (T-154, FlashList). Un solo `kind` — a
 * diferencia de Actividad no hay encabezados de sección acá. */
export function buildGroupsFlatItems(groups: Group[]): GroupsFlatItem[] {
  return groups.map((g, i) => ({ kind: 'group', id: g.id, group: g, isLast: i === groups.length - 1 }));
}

/**
 * Fila de grupo con swipe-to-archive. Cada ítem lleva su PROPIO `Band` (antes
 * era un `Band` compartido envolviendo todas las filas) — `noTop` siempre (no
 * hay nada arriba de la lista que ponga su propia línea, como en Actividad;
 * acá el `Band` de la primera fila es el que abre el bloque, igual que
 * antes) y `noBottom` salvo en la última fila, que cierra el bloque con la
 * línea de abajo — visualmente idéntico al `Band` compartido de antes.
 */
export function GroupsListItem({
  item, tab, currentUserId, canUnarchive, onOpenGroup, onArchiveAction,
}: {
  item: GroupsFlatItem;
  tab: GroupsTab;
  currentUserId: string;
  canUnarchive: (id: string) => boolean;
  onOpenGroup: (id: string) => void;
  onArchiveAction: (id: string) => void;
}) {
  const g = item.group;
  return (
    <Band noTop noBottom={!item.isLast}>
      <SwipeToArchive
        archived={tab === 'archivados'}
        disabled={tab === 'archivados' && !canUnarchive(g.id)}
        onAction={() => onArchiveAction(g.id)}
      >
        <GroupRow
          group={g}
          currentUserId={currentUserId}
          last={item.isLast}
          onPress={onOpenGroup}
        />
      </SwipeToArchive>
    </Band>
  );
}

/** Leyenda "no suman al balance" — sólo en la pestaña archivados, pie de la lista. */
export function ArchivedHint({ tab }: { tab: GroupsTab }) {
  const { t } = useTranslation();
  const c = useColors();
  if (tab !== 'archivados') return null;
  return (
    <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
      {t('groups.archived_hint')}
    </Text>
  );
}

const styles = StyleSheet.create({
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
});
