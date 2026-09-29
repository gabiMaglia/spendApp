import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band } from '@/src/components/Band';
import type { PanelSegmento } from '@/src/components/skin/Panel';
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
  | { kind: 'header'; id: string; label: string; topOverride?: number; showBadge: boolean }
  | { kind: 'fila'; id: string; event: ActivityKind; isLast: boolean; segmento: PanelSegmento };

/**
 * T-154 (3ra vuelta — decisión del orquestador): el ítem = SECCIÓN (2da
 * vuelta) no dejaba virtualizar DENTRO de "Antes" (única, sin importar
 * cuántos eventos reales tenga). Vuelve a ítem = FILA — la ventana
 * simulada del mock de FlashList vuelve a recortar filas de verdad — pero
 * con el panel Aero SEGMENTADO por fila (`Panel.tsx`/`segmento`) para que
 * varias filas seguidas se lean como UNA sola tarjeta continua, no una
 * tarjeta por fila (el defecto que QA rechazó en la 1ra vuelta).
 */
export function buildActivityFlatItems(
  sections: ActivitySection[], todayLabel: string,
): ActivityFlatItem[] {
  const items: ActivityFlatItem[] = [];
  sections.forEach(({ label, events }, seccionIdx) => {
    items.push({
      kind: 'header',
      id: `header:${label}`,
      label,
      // PO 2026-09-28: la primera franja («Hoy») va PEGADA a la barra de
      // búsqueda, sin aire arriba (antes T-108 le daba Spacing[8]=40).
      topOverride: seccionIdx === 0 ? 9 : undefined,
      showBadge: label === todayLabel,
    });
    events.forEach((ev, i) => {
      const segmento: PanelSegmento =
        events.length === 1 ? 'unica' : i === 0 ? 'primera' : i === events.length - 1 ? 'ultima' : 'media';
      items.push({
        kind: 'fila',
        id: `fila:${eventId(ev)}:${ev.kind}`,
        event: ev,
        isLast: i === events.length - 1,
        segmento,
      });
    });
  });
  return items;
}

/**
 * Ítem individual de la lista aplanada. `EventRow` no cambia — sigue
 * dibujando su propio hairline interno entre filas via `last` (Clásico).
 * En Aero, `segmento` hace que varias filas seguidas armen UNA tarjeta
 * continua (ver `Panel.tsx`).
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

  if (item.kind === 'header') {
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
    <Band noTop noBottom={!item.isLast} segmento={item.segmento}>
      <EventRow
        event={item.event}
        last={item.isLast}
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
