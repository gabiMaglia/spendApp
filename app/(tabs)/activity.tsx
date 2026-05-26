import React, { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useSyncStore } from '@/src/store/syncStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useActivityFeed } from '@/src/store/selectors';
import type { ActivityKind } from '@/src/store/selectors';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';

function relativeTime(ts: number): string {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  if (diffMin < 60)  return `hace ${diffMin} min`;
  if (diffH   < 24)  return `hace ${diffH} h`;
  if (diffD   === 1) return `ayer`;
  return `hace ${diffD} días`;
}

export default function ActivityScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { state: syncState } = useSyncStore();
  const { currentUser } = useAuthStore();
  const { getUserName } = useUserStore();
  const groups   = useGroupStore(s => s.groups);
  const feed     = useActivityFeed(currentUser?.id ?? '');

  const allGroupNames = ['Todos', ...groups.map(g => g.name)];
  const [activeFilter, setActiveFilter] = useState('Todos');

  const filteredFeed = activeFilter === 'Todos'
    ? feed
    : feed.filter(ev => {
        const gName = ev.kind === 'payment_made' ? ev.groupName : ev.groupName;
        return gName === activeFilter;
      });

  // Agrupa por sección temporal
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  type Section = { label: string; events: ActivityKind[] };
  const sections: Section[] = [];

  const todayEvents     = filteredFeed.filter(ev => getTs(ev) >= todayStart.getTime());
  const yesterdayEvents = filteredFeed.filter(ev => getTs(ev) >= yesterdayStart.getTime() && getTs(ev) < todayStart.getTime());
  const olderEvents     = filteredFeed.filter(ev => getTs(ev) < yesterdayStart.getTime());

  if (todayEvents.length)     sections.push({ label: t('activity.section_today'),     events: todayEvents });
  if (yesterdayEvents.length) sections.push({ label: t('activity.section_yesterday'), events: yesterdayEvents });
  if (olderEvents.length)     sections.push({ label: 'Antes',                          events: olderEvents });

  const todayNewCount = todayEvents.length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <SyncStatusBadge state={syncState} />
          <Pressable style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}>
            <Ionicons name="search-outline" size={18} color={c.text} />
          </Pressable>
        </View>
        <View style={styles.titleRow}>
          <Text style={[Typography.display, { color: c.text }]}>{t('activity.title')}</Text>
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {allGroupNames.map(f => (
            <Pressable
              key={f}
              onPress={() => setActiveFilter(f)}
              style={[
                styles.chip,
                activeFilter === f
                  ? { backgroundColor: c.brand.primary, borderColor: c.brand.primary }
                  : { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: activeFilter === f ? '#fff' : c.textSecondary }}>
                {f}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Sections */}
        {sections.map(({ label, events }) => (
          <View key={label}>
            <View style={styles.sectionHeader}>
              <Text style={[Typography.label, { color: c.textTertiary }]}>{label}</Text>
              {label === t('activity.section_today') && todayNewCount > 0 && (
                <View style={[styles.unseenBadge, { backgroundColor: c.brand.primary }]}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                    {t('activity.unseen_count', { count: todayNewCount })}
                  </Text>
                </View>
              )}
            </View>
            {events.map((ev, i) => (
              <EventRow key={i} event={ev} getUserName={getUserName} currentUserId={currentUser?.id ?? ''} />
            ))}
          </View>
        ))}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getTs(ev: ActivityKind): number {
  if (ev.kind === 'expense_added' || ev.kind === 'expense_delete_request') return ev.expense.date;
  return ev.payment.date;
}

function EventRow({
  event, getUserName, currentUserId,
}: {
  event: ActivityKind;
  getUserName: (id: string) => string;
  currentUserId: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (event.kind === 'expense_added') {
    const { expense, groupName } = event;
    const isMe   = expense.paidById === currentUserId;
    const who    = isMe ? 'Vos' : getUserName(expense.paidById);
    const action = isMe ? 'registraste' : 'registró';
    const ts     = relativeTime(expense.date);

    return (
      <View style={[styles.row, { paddingHorizontal: Spacing.screenPad }]}>
        <View style={[styles.rowIcon, { backgroundColor: '#0A6E8F' }]}>
          <Ionicons name="add-outline" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[Typography.bodyM, { color: c.text, lineHeight: 20 }]}>
            <Text style={{ fontWeight: '700' }}>{who}</Text>
            {` ${action} `}
            <Text style={{ color: c.textSecondary }}>{expense.description} · {groupName}</Text>
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>{ts}</Text>
        </View>
        <Text style={[Typography.amountM, { color: c.text }]}>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
      </View>
    );
  }

  if (event.kind === 'expense_delete_request') {
    const { expense, groupName, requestedByName } = event;
    const ts = relativeTime(expense.deletionVotes[0]?.votedAt ?? expense.date);

    return (
      <View style={[styles.row, { backgroundColor: c.semantic.warningSoft, marginHorizontal: 12, borderRadius: Radius.md }]}>
        <View style={[styles.rowIcon, { backgroundColor: '#D4A24A' }]}>
          <Ionicons name="warning-outline" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[Typography.bodyM, { color: c.text, lineHeight: 20 }]}>
            <Text style={{ fontWeight: '700' }}>{requestedByName}</Text>
            {` solicitó borrar `}
            <Text style={{ color: c.textSecondary }}>"{expense.description}" · {groupName}</Text>
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>{ts}</Text>
        </View>
      </View>
    );
  }

  // payment_made
  const { payment, groupName } = event;
  const isMe   = payment.fromUserId === currentUserId;
  const who    = isMe ? 'Vos' : getUserName(payment.fromUserId);
  const toName = getUserName(payment.toUserId);
  const ts     = relativeTime(payment.date);

  return (
    <View style={[styles.row, { paddingHorizontal: Spacing.screenPad }]}>
      <View style={[styles.rowIcon, { backgroundColor: '#2E8B57' }]}>
        <Ionicons name="arrow-forward-outline" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, lineHeight: 20 }]}>
          <Text style={{ fontWeight: '700' }}>{who}</Text>
          {` pagó a `}
          <Text style={{ fontWeight: '700' }}>{toName}</Text>
          <Text style={{ color: c.textSecondary }}> · {groupName}</Text>
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>{ts}</Text>
      </View>
      <Text style={[Typography.amountM, { color: '#2E8B57' }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  header:        {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  titleRow:      { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[3] },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filters:       { paddingHorizontal: Spacing.screenPad, gap: 8, paddingBottom: Spacing[3] },
  chip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[2], paddingBottom: Spacing[1],
  },
  unseenBadge:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  row:           {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    paddingVertical: 12,
  },
  rowIcon:       {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
