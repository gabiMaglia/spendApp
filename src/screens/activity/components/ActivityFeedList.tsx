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

/** Id estable de un evento del feed — un mismo gasto puede aparecer dos veces
 * (agregado y borrado), así que el id solo no alcanza: hace falta `kind`. */
function eventId(ev: ActivityKind): string {
  if (ev.kind === 'payment_made') return ev.payment.id;
  if (ev.kind === 'personal_entry') return ev.entry.id;
  return ev.expense.id;
}

export type ActivityFlatItem =
  | { kind: 'section-header'; id: string; label: string; topOverride?: number; showBadge: boolean }
  | { kind: 'event'; id: string; event: ActivityKind; isLastInSection: boolean };

/**
 * Aplana secciones + eventos en un solo array (T-154): FlashList necesita
 * ítems planos, no una `View` por sección con un `.map()` adentro. El
 * encabezado de sección pasa a ser un ítem más, distinguido por `kind` para
 * que `getItemType`/`renderItem` sepan cuál de las dos formas dibujar.
 */
export function buildActivityFlatItems(
  sections: ActivitySection[],
  todayLabel: string,
): ActivityFlatItem[] {
  const items: ActivityFlatItem[] = [];
  sections.forEach(({ label, events }, seccionIdx) => {
    items.push({
      kind: 'section-header',
      id: `header:${label}`,
      label,
      // PO 2026-09-28: la primera franja («Hoy») va PEGADA a la barra de
      // búsqueda, sin aire arriba (antes T-108 le daba Spacing[8]=40).
      topOverride: seccionIdx === 0 ? 9 : undefined,
      showBadge: label === todayLabel,
    });
    events.forEach((ev, i) => {
      items.push({
        kind: 'event',
        id: `event:${eventId(ev)}:${ev.kind}`,
        event: ev,
        isLastInSection: i === events.length - 1,
      });
    });
  });
  return items;
}

/**
 * Ítem individual de la lista aplanada. Cada evento se envuelve en su PROPIO
 * `Band` (antes era un `Band` compartido por sección, con todos los
 * `EventRow` adentro) — visualmente idéntico: `noTop` siempre (la línea de
 * arriba la pone el encabezado de sección), y `noBottom` salvo en el último
 * evento de la sección, que cierra el bloque con la línea de abajo que antes
 * ponía el `Band` compartido. `EventRow` sigue dibujando su propio hairline
 * INTERNO entre filas via `last` (sin cambios en `EventRow.tsx`).
 */
export function ActivityFeedItem({
  item, todayNewCount, getUserName, currentUserId, onRestore, trustFor,
}: {
  item: ActivityFlatItem;
  todayNewCount: number;
  getUserName: (id: string) => string;
  currentUserId: string;
  onRestore: (expenseId: string) => void;
  trustFor: (ev: ActivityKind) => TrustState;
}) {
  const { t } = useTranslation();
  const c = useColors();

  if (item.kind === 'section-header') {
    return (
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
    );
  }

  return (
    <Band noTop noBottom={!item.isLastInSection}>
      <EventRow
        event={item.event}
        last={item.isLastInSection}
        trust={trustFor(item.event)}
        getUserName={getUserName}
        currentUserId={currentUserId}
        onRestore={onRestore}
      />
    </Band>
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
