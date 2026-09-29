import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band } from '@/src/components/Band';
import { EmptyState } from '@/src/components/EmptyState';
import { PERSONAL_ACTIVITY_KEY, type ActivityKind } from '@/src/store/selectors';
import type { TrustState } from '@/src/algorithms/recordTrust';
import type { ActivitySection } from '@/src/screens/activity/hooks/useActivitySections';
import { ActivitySectionHeader } from './ActivitySectionHeader';
import { EventRow } from './EventRow';
import { useColors } from '@/src/skins/useSkin';

/**
 * T-154 (rechazo QA, engram/qa/T-154.md): el ítem de FlashList es la
 * SECCIÓN (Hoy/Ayer/Antes), no la fila — un `Band` por fila rompía el
 * agrupamiento Aero (`Band` → `Panel` propio por fila en vez de UNA tarjeta
 * por sección, ver `Band.tsx:83-88`). Con las 3 secciones que arma
 * `useActivitySections` (todoy/ayer/antes, nunca más de 3), la lista de
 * `FlashList` recibe directamente `sections` — la virtualización acá corta
 * SECCIONES fuera de la ventana, no filas dentro de una sección.
 */
export type ActivitySectionItem = ActivitySection & { id: string; topOverride?: number; showBadge: boolean };

export function buildActivitySectionItems(
  sections: ActivitySection[], todayLabel: string,
): ActivitySectionItem[] {
  return sections.map((s, i) => ({
    ...s,
    id: s.label,
    // PO 2026-09-28: la primera franja («Hoy») va PEGADA a la barra de
    // búsqueda, sin aire arriba (antes T-108 le daba Spacing[8]=40).
    topOverride: i === 0 ? 9 : undefined,
    showBadge: s.label === todayLabel,
  }));
}

/**
 * Una sección completa — EXACTAMENTE el JSX de `ff2c4eb`: el encabezado +
 * UN `Band` compartido envolviendo TODOS los `EventRow` de esa sección (no
 * un `Band` por fila). `EventRow` no cambia — sigue dibujando su propio
 * hairline interno entre filas via `last`.
 */
export function ActivitySectionBlock({
  item, todayNewCount, getUserName, currentUserId, onRestore, trustFor,
}: {
  item: ActivitySectionItem;
  todayNewCount: number;
  getUserName: (id: string) => string;
  currentUserId: string;
  onRestore: (expenseId: string) => void;
  trustFor: (ev: ActivityKind) => TrustState;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <View>
      <ActivitySectionHeader
        label={item.label}
        topOverride={item.topOverride}
        right={
          item.showBadge && todayNewCount > 0 ? (
            <View style={[styles.unseenBadge, { backgroundColor: c.brand.primary }]}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {t('activity.unseen_count', { count: todayNewCount })}
              </Text>
            </View>
          ) : undefined
        }
      />
      <Band noTop>
        {item.events.map((ev, i) => (
          <EventRow
            key={i}
            event={ev}
            last={i === item.events.length - 1}
            trust={trustFor(ev)}
            getUserName={getUserName}
            currentUserId={currentUserId}
            onRestore={onRestore}
          />
        ))}
      </Band>
    </View>
  );
}

/** Estado vacío: feed entero vacío, o vacío por el filtro/búsqueda actual. */
export function ActivityEmptyState({
  feedIsEmpty, activeFilter,
}: { feedIsEmpty: boolean; activeFilter: string }) {
  const { t } = useTranslation();
  const c = useColors();

  if (feedIsEmpty) {
    return <EmptyState iconName="time-outline" title={t('activity.empty_title')} body={t('activity.empty_body')} />;
  }

  return (
    <View style={styles.emptyFilter}>
      <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center' }]}>
        {t('activity.no_filter_results', {
          name: activeFilter === PERSONAL_ACTIVITY_KEY ? t('activity.filter_personal') : activeFilter,
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  unseenBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.full },
  emptyFilter: {
    flex: 1, justifyContent: 'center',
    paddingVertical: Spacing[8], paddingHorizontal: Spacing.screenPad,
  },
});
