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

export function ActivityFeedList({
  feedIsEmpty, filteredIsEmpty, activeFilter, sections, todayNewCount,
  getUserName, currentUserId, onRestore, trustFor,
}: {
  feedIsEmpty: boolean;
  filteredIsEmpty: boolean;
  activeFilter: string;
  sections: ActivitySection[];
  todayNewCount: number;
  getUserName: (id: string) => string;
  currentUserId: string;
  onRestore: (expenseId: string) => void;
  trustFor: (ev: ActivityKind) => TrustState;
}) {
  const { t } = useTranslation();
  const c = useColors();

  if (feedIsEmpty) {
    return <EmptyState iconName="time-outline" title={t('activity.empty_title')} body={t('activity.empty_body')} />;
  }

  if (filteredIsEmpty) {
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

  return (
    <>
      {sections.map(({ label, events }, seccionIdx) => (
        <View key={label}>
          <ActivitySectionHeader
            label={label}
            // PO 2026-09-28: la primera franja («Hoy») va PEGADA a la barra de
            // búsqueda, sin aire arriba (antes T-108 le daba Spacing[8]=40).
            // Las siguientes conservan su aire: son espacio INTERNO de la lista.
            topOverride={seccionIdx === 0 ? 9 : undefined}
            right={
              label === t('activity.section_today') && todayNewCount > 0 ? (
                <View style={[styles.unseenBadge, { backgroundColor: c.brand.primary }]}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {t('activity.unseen_count', { count: todayNewCount })}
                  </Text>
                </View>
              ) : undefined
            }
          />
          <Band noTop>
            {events.map((ev, i) => (
              <EventRow
                key={i}
                event={ev}
                last={i === events.length - 1}
                trust={trustFor(ev)}
                getUserName={getUserName}
                currentUserId={currentUserId}
                onRestore={onRestore}
              />
            ))}
          </Band>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  unseenBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.full },
  emptyFilter: {
    flex: 1, justifyContent: 'center',
    paddingVertical: Spacing[8], paddingHorizontal: Spacing.screenPad,
  },
});
