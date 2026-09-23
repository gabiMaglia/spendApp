import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band } from '@/src/components/Band';
import { SwipeToArchive } from '@/src/components/SwipeToArchive';
import type { Group } from '@/src/types/models';
import type { GroupsTab } from '@/src/screens/groups/hooks/useGroupsList';
import { GroupRow } from './GroupRow';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

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
