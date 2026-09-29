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

/** El único ítem que arma `groups.tsx` para la `FlashList` — un bloque completo. */
export type GroupsFlatItem = { kind: 'bloque'; id: 'bloque' };

/**
 * T-154 (rechazo QA): el ítem de FlashList es el BLOQUE completo, no la
 * fila — un `Band` por fila rompía el agrupamiento Aero (`Band` → `Panel`
 * propio por fila en vez de UNA tarjeta para todo el bloque, ver
 * `Band.tsx:83-88`). `GroupsList` vuelve a ser exactamente el JSX de
 * `ff2c4eb`: UN `Band` compartido envolviendo todas las filas. Con un solo
 * bloque por pantalla, `groups.tsx` lo usa como el único ítem de la
 * `FlashList` (`buildGroupsFlatItems`) — la ganancia de virtualizar acá es
 * de escala futura (más bloques), no de este dataset.
 */
export function buildGroupsFlatItems(groups: Group[]): GroupsFlatItem[] {
  return groups.length > 0 ? [{ kind: 'bloque', id: 'bloque' }] : [];
}

/**
 * Filas de grupos con swipe-to-archive + la leyenda de archivados. El estado
 * vacío es decisión de la pantalla (`groups.tsx`), no de este componente: el
 * "total" que va a continuación sólo se muestra junto con la lista, nunca
 * junto al estado vacío — más fácil de leer resuelto una vez arriba.
 */
export function GroupsList({
  groups, tab, currentUserId, canUnarchive, onOpenGroup, onArchiveAction,
}: {
  groups: Group[];
  tab: GroupsTab;
  currentUserId: string;
  canUnarchive: (id: string) => boolean;
  onOpenGroup: (id: string) => void;
  onArchiveAction: (id: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      <Band noTop>
        {groups.map((g, i) => (
          <SwipeToArchive
            key={g.id}
            archived={tab === 'archivados'}
            disabled={tab === 'archivados' && !canUnarchive(g.id)}
            onAction={() => onArchiveAction(g.id)}
          >
            <GroupRow
              group={g}
              currentUserId={currentUserId}
              last={i === groups.length - 1}
              onPress={onOpenGroup}
            />
          </SwipeToArchive>
        ))}
      </Band>
      {/* La leyenda "deslizá para archivar" se sacó (PO 2026-09-22): con el
          "total total" pegado abajo, la banda de grupos y la del total tienen
          que leerse como UNA sola pieza, sin una leyenda de por medio
          separándolas. La de archivados sigue — informa algo real (no suman
          al balance), no es un tutorial de gesto. */}
      {tab === 'archivados' && (
        <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
          {t('groups.archived_hint')}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
});
