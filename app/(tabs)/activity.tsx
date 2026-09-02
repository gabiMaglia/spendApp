import React, { useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useActivityFeed } from '@/src/store/selectors';
import { searchActivity } from '@/src/algorithms/searchActivity';
import { deletionRound } from '@/src/algorithms/deletionRound';
import { attributedVote, isMarked, type TrustState } from '@/src/algorithms/recordTrust';
import { TrustMark } from '@/src/components/TrustMark';
import { useRecordTrust, useVoteTrust, voteRefKey } from '@/src/hooks/useRecordTrust';
import { emitirVoto } from '@/src/services/deletionVotes';
import { ActivityLine } from '@/src/components/ActivityLine';
import type { ActivityKind } from '@/src/store/selectors';
import { EmptyState } from '@/src/components/EmptyState';
import { Band, SectionLabel } from '@/src/components/Band';
import { CollapsibleHeader, HeaderAvatar, useHeaderPadding } from '@/src/components/CollapsibleHeader';
import { hapticSelection } from '@/src/utils/haptics';
import { syncedNow } from '@/src/utils/syncedClock';

function relativeTime(ts: number): string {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  if (diffMin < 1)  return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffH   < 24) return `hace ${diffH} h`;
  if (diffD   === 1) return 'ayer';
  return `hace ${diffD} días`;
}

export default function ActivityScreen() {
  const { t } = useTranslation();
  const headerPad = useHeaderPadding();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { getUserName } = useUserStore();
  const updateExpense = useExpenseStore(st => st.updateExpense);
  const scrollY = useRef(new Animated.Value(0)).current;

  function restaurar(expenseId: string) {
    const gasto = useExpenseStore.getState().expenses.find(e => e.id === expenseId);
    if (!gasto || !currentUser) return;
    updateExpense(expenseId, {
      isDeleted: false,
      deletionVotes: emitirVoto(gasto, currentUser.id, 'restore', syncedNow()),
    });
  }

  const groups = useGroupStore(s => s.groups);
  const feed   = useActivityFeed(currentUser?.id ?? '');

  const ahora = syncedNow();
  const [query, setQuery] = useState('');

  const ALL_FILTER = '__all__';
  const allGroupNames = [ALL_FILTER, ...groups.filter(g => !g.isDeleted).map(g => g.name)];
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);

  const porGrupo = activeFilter === ALL_FILTER
    ? feed
    : feed.filter(ev => ev.groupName === activeFilter);
  const filteredFeed = searchActivity(porGrupo, query, getUserName);

  const gastosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'expense_added' || ev.kind === 'expense_deleted' ? [ev.expense] : []);

  const pagosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'payment_made' ? [ev.payment] : []);

  const votosDelFeed = filteredFeed.flatMap(ev => {
    if (ev.kind !== 'expense_delete_request' && ev.kind !== 'expense_restored') return [];
    const vote = attributedVote(deletionRound(ev.expense, ahora), ev.expense.deletionVotes ?? []);
    return vote ? [{ expenseId: ev.expense.id, vote }] : [];
  });

  const marcaDeGasto = useRecordTrust('expense', gastosDelFeed);
  const marcaDePago  = useRecordTrust('payment', pagosDelFeed);
  const marcaDeVoto  = useVoteTrust(votosDelFeed);

  function marcaDeEvento(ev: ActivityKind): TrustState {
    if (ev.kind === 'payment_made') return marcaDePago[ev.payment.id] ?? 'pendiente';
    if (ev.kind === 'expense_added' || ev.kind === 'expense_deleted') {
      return marcaDeGasto[ev.expense.id] ?? 'pendiente';
    }
    const vote = attributedVote(deletionRound(ev.expense, ahora), ev.expense.deletionVotes ?? []);
    return vote ? marcaDeVoto[voteRefKey(ev.expense.id, vote)] ?? 'pendiente' : 'pendiente';
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  type Section = { label: string; events: ActivityKind[] };
  const sections: Section[] = [];

  const todayEvents     = filteredFeed.filter(ev => getTs(ev) >= todayStart.getTime());
  const yesterdayEvents = filteredFeed.filter(ev => getTs(ev) >= yesterdayStart.getTime() && getTs(ev) < todayStart.getTime());
  const olderEvents     = filteredFeed.filter(ev => getTs(ev) < yesterdayStart.getTime());

  if (todayEvents.length)     sections.push({ label: t('activity.section_today'),     events: todayEvents });
  if (yesterdayEvents.length) sections.push({ label: t('activity.section_yesterday'), events: yesterdayEvents });
  if (olderEvents.length)     sections.push({ label: t('activity.section_older'),     events: olderEvents });

  const todayNewCount = todayEvents.length;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 120 }}
      >
        <Text style={[Typography.display, styles.title, { color: c.text }]}>{t('activity.title')}</Text>

        <View style={[styles.searchBar, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
          <Ionicons name="search-outline" size={15} color={c.textTertiary} />
          <TextInput
            testID="activity-search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('activity.search_placeholder')}
            placeholderTextColor={c.textTertiary}
            style={[Typography.bodyM, { color: c.text, flex: 1, padding: 0 }]}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query !== '' && (
            <Pressable
              testID="activity-search-clear"
              accessibilityRole="button"
              onPress={() => setQuery('')}
              hitSlop={10}
            >
              <Ionicons name="close-circle" size={16} color={c.textTertiary} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {allGroupNames.map(f => {
            const on = activeFilter === f;
            return (
              <Pressable
                key={f}
                onPress={() => { hapticSelection(); setActiveFilter(f); }}
                style={[
                  styles.chip,
                  on
                    ? { backgroundColor: c.brand.primary, borderColor: c.brand.primary }
                    : { backgroundColor: c.surface, borderColor: c.hair },
                ]}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? '#fff' : c.textSecondary }}>
                  {f === ALL_FILTER ? t('activity.filter_all') : f}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {feed.length === 0 ? (
          <EmptyState iconName="time-outline" title={t('activity.empty_title')} body={t('activity.empty_body')} />
        ) : filteredFeed.length === 0 ? (
          <View style={styles.emptyFilter}>
            <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center' }]}>
              {t('activity.no_filter_results', { name: activeFilter })}
            </Text>
          </View>
        ) : (
          sections.map(({ label, events }) => (
            <View key={label}>
              <SectionLabel
                label={label}
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
              <Band>
                {events.map((ev, i) => (
                  <EventRow
                    key={i}
                    event={ev}
                    last={i === events.length - 1}
                    trust={marcaDeEvento(ev)}
                    getUserName={getUserName}
                    currentUserId={currentUser?.id ?? ''}
                    onRestore={restaurar}
                  />
                ))}
              </Band>
            </View>
          ))
        )}
      </Animated.ScrollView>

      <CollapsibleHeader
        title={t('activity.title')}
        scrollY={scrollY}
        left={<HeaderAvatar initials={(currentUser?.name ?? '?').slice(0, 2).toUpperCase()} />}
      />
    </SafeAreaView>
  );
}

function getTs(ev: ActivityKind): number {
  if (ev.kind === 'expense_added' || ev.kind === 'expense_delete_request') return ev.expense.date;
  if (ev.kind === 'expense_deleted' || ev.kind === 'expense_restored') {
    return ev.expense.updatedAt || ev.expense.date;
  }
  return ev.payment.date;
}

/**
 * Fila de evento. En el reskin todas las variantes comparten la MISMA caja
 * (fila de banda con hairline): lo que cambia es el ícono teñido, el color del
 * monto y, en el pedido de borrado, el fondo de advertencia.
 */
function EventRow({
  event, trust, getUserName, currentUserId, onRestore, last,
}: {
  event: ActivityKind;
  trust: TrustState;
  onRestore: (expenseId: string) => void;
  getUserName: (id: string) => string;
  currentUserId: string;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const marca = isMarked(trust)
    ? <TrustMark label={t('trust.badge')} size="sm" testID={`trust-${event.kind}`} />
    : null;

  const row = (opts: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    bg: string;
    body: React.ReactNode;
    right?: React.ReactNode;
    warn?: boolean;
    onPress?: () => void;
  }) => {
    const Container: any = opts.onPress ? Pressable : View;
    return (
      <Container
        onPress={opts.onPress}
        style={({ pressed }: { pressed?: boolean } = {}) => [
          styles.row,
          {
            borderBottomWidth: last ? 0 : 1,
            // `hair` y no `hair2`: el divisor tenue está calibrado para filas de
            // una línea, y estas llevan dos más el timestamp. A esa altura el
            // 5,5% se pierde y las filas se leen como una sola.
            borderBottomColor: c.hair,
            backgroundColor: opts.warn ? c.semantic.warningSoft : 'transparent',
          },
          pressed && { backgroundColor: c.bgGrouped },
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: opts.bg }]}>
          <Ionicons name={opts.icon} size={16} color={opts.tint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {opts.body}
          {marca}
        </View>
        {opts.right}
      </Container>
    );
  };

  if (event.kind === 'expense_added') {
    const { expense, groupName } = event;
    const isMe   = expense.paidById === currentUserId;
    const who    = isMe ? t('common.you') : getUserName(expense.paidById);
    const action = isMe ? t('activity.action_registered_own') : t('activity.action_registered_other');
    return row({
      icon: 'add-outline', tint: c.brand.primary, bg: c.brand.primarySoft,
      onPress: () => router.push(`/expense/${expense.id}` as any),
      body: <ActivityLine who={who} action={action} subject={`${expense.description} · ${groupName}`} ts={relativeTime(expense.date)} />,
      right: (
        <Text style={[Typography.amountS, { color: c.text }]}>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
      ),
    });
  }

  if (event.kind === 'expense_delete_request') {
    const { expense, groupName, requestedByName } = event;
    return row({
      icon: 'warning-outline', tint: c.semantic.warning, bg: c.semantic.warningSoft, warn: true,
      body: (
        <ActivityLine
          who={requestedByName}
          action={t('activity.action_requested_delete')}
          subject={`“${expense.description}” · ${groupName}`}
          ts={relativeTime(expense.deletionVotes?.[0]?.votedAt ?? expense.date)}
        />
      ),
    });
  }

  if (event.kind === 'expense_deleted') {
    const { expense, groupName } = event;
    return row({
      icon: 'trash-outline', tint: c.textTertiary, bg: c.hair2,
      body: (
        <>
          <Text
            style={[Typography.bodyM, { color: c.textSecondary, textDecorationLine: 'line-through' }]}
            numberOfLines={1}
          >
            {t('activity.deleted_title', { desc: expense.description })}
          </Text>
          <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 2 }]}>
            {groupName} · {relativeTime(expense.updatedAt || expense.date)}
          </Text>
        </>
      ),
      right: (
        <Pressable
          testID={`restore-${expense.id}`}
          accessibilityRole="button"
          onPress={() => onRestore(expense.id)}
          hitSlop={8}
        >
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: c.brand.primary }}>
            {t('activity.restore')}
          </Text>
        </Pressable>
      ),
    });
  }

  if (event.kind === 'expense_restored') {
    const { expense, groupName, restoredByName } = event;
    return row({
      icon: 'arrow-undo-outline', tint: c.textTertiary, bg: c.hair2,
      body: (
        <ActivityLine
          who={restoredByName}
          action={t('activity.action_restored')}
          subject={`“${expense.description}” · ${groupName}`}
          ts={relativeTime(expense.updatedAt || expense.date)}
        />
      ),
    });
  }

  const { payment, groupName } = event;
  const isMe   = payment.fromUserId === currentUserId;
  const who    = isMe ? t('common.you') : getUserName(payment.fromUserId);
  const toName = getUserName(payment.toUserId);
  return row({
    icon: 'arrow-forward-outline', tint: c.semantic.positive, bg: c.semantic.positiveSoft,
    body: (
      <>
        <Text style={[Typography.bodyM, { color: c.textSecondary, lineHeight: 20 }]}>
          <Text style={{ fontWeight: '700', color: c.text }}>{who}</Text>
          {` ${t('activity.action_paid')} `}
          <Text style={{ fontWeight: '700', color: c.text }}>{toName}</Text>
          <Text> · {groupName}</Text>
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 2 }]}>
          {relativeTime(payment.date)}
        </Text>
      </>
    ),
    right: (
      <Text style={[Typography.amountS, { color: c.semantic.positive }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    ),
  });
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  title:       { paddingHorizontal: Spacing.screenPad, paddingBottom: 14 },
  searchBar:   {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: Spacing.screenPad, marginBottom: 12,
    paddingHorizontal: 13, height: 40,
    borderRadius: Radius.md, borderWidth: 1,
  },
  filters:     { paddingHorizontal: Spacing.screenPad, gap: 7, paddingBottom: 2 },
  chip:        { paddingHorizontal: 13, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1 },
  unseenBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.full },
  row:         {
    flexDirection: 'row', gap: 13, alignItems: 'flex-start',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  rowIcon:     {
    width: 32, height: 32, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  emptyFilter: { paddingVertical: Spacing[8], paddingHorizontal: Spacing.screenPad },
});
