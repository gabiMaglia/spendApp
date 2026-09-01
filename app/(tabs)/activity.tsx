import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { hapticSelection } from '@/src/utils/haptics';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { getUserName } = useUserStore();
  const updateExpense = useExpenseStore(st => st.updateExpense);

  /**
   * Deshacer un borrado. Es la contraparte del modo de borrado LIBRE, pero se
   * ofrece en los dos modos: deshacer nunca puede ser más difícil que hacer.
   *
   * Además del tombstone hay que frenar la ronda, o `resolvePendingDeletions`
   * vuelve a borrar el gasto solo en el próximo arranque y el usuario ve
   * reaparecer el borrado sin haber tocado nada. Se frena AGREGANDO mi voto y
   * no vaciando el conjunto: desde el merge por niveles los votos se unen, así
   * que un vaciado vuelve del primer peer que sincronice.
   *
   * Y el voto es un `restore` propio, no una objeción (R-Q2 del PO): en el feed
   * esto tiene que decir «restauró», que es lo que pasó.
   */
  function restaurar(expenseId: string) {
    const gasto = useExpenseStore.getState().expenses.find(e => e.id === expenseId);
    if (!gasto || !currentUser) return;
    updateExpense(expenseId, {
      isDeleted: false,
      deletionVotes: emitirVoto(gasto, currentUser.id, 'restore', Date.now()),
    });
  }
  const groups   = useGroupStore(s => s.groups);
  const feed     = useActivityFeed(currentUser?.id ?? '');
  const [query, setQuery] = useState('');

  const ALL_FILTER = '__all__';
  const allGroupNames = [ALL_FILTER, ...groups.filter(g => !g.isDeleted).map(g => g.name)];
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);

  // El filtro por grupo y la búsqueda se combinan: buscar dentro de un grupo
  // filtrado es lo que uno espera, y no que la búsqueda pise el filtro.
  const porGrupo = activeFilter === ALL_FILTER
    ? feed
    : feed.filter(ev => ev.groupName === activeFilter);
  const filteredFeed = searchActivity(porGrupo, query, getUserName);

  /**
   * **La marca de T-041 en el feed** (S10). R1 lo pide con todas las letras: un
   * registro que no verifica *salta en el feed de actividad*.
   *
   * Se verifica sólo lo que el feed está mostrando (D8), y se separan dos cosas
   * que firman personas distintas:
   *
   *  - las filas de un **registro** (gasto agregado, gasto borrado, pago) llevan
   *    el veredicto del núcleo, que declaró su autor;
   *  - las filas de una **ronda** (pedido de borrado, restauración) llevan el
   *    del voto que la fila atribuye — «Ana pidió borrar» es un enunciado de
   *    Ana, no del autor del gasto.
   *
   * La marca se suma a la fila; no se agrega un evento nuevo. Un evento aparte
   * duplicaría el mismo gasto —«agregado» y «no verificado»— y R1 pide que
   * aparezca *como cualquier gasto*, marcado.
   *
   * **Sin `useMemo`, a propósito.** Lo que la cola usa para saber si el conjunto
   * cambió no es la identidad de estos arrays sino el contenido de cada fila
   * (`useRecordTrust`), así que memoizarlos no evitaría un solo reinicio: sería
   * ceremonia que aparenta ser una garantía. Se comprobó rompiéndolo.
   */
  const gastosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'expense_added' || ev.kind === 'expense_deleted' ? [ev.expense] : []);

  const pagosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'payment_made' ? [ev.payment] : []);

  const votosDelFeed = filteredFeed.flatMap(ev => {
    if (ev.kind !== 'expense_delete_request' && ev.kind !== 'expense_restored') return [];
    const vote = attributedVote(deletionRound(ev.expense), ev.expense.deletionVotes ?? []);
    return vote ? [{ expenseId: ev.expense.id, vote }] : [];
  });

  const marcaDeGasto = useRecordTrust('expense', gastosDelFeed);
  const marcaDePago  = useRecordTrust('payment', pagosDelFeed);
  const marcaDeVoto  = useVoteTrust(votosDelFeed);

  /** Qué marca le toca a cada fila, según qué firma es la que la sostiene. */
  function marcaDeEvento(ev: ActivityKind): TrustState {
    if (ev.kind === 'payment_made') return marcaDePago[ev.payment.id] ?? 'pendiente';
    if (ev.kind === 'expense_added' || ev.kind === 'expense_deleted') {
      return marcaDeGasto[ev.expense.id] ?? 'pendiente';
    }
    const vote = attributedVote(deletionRound(ev.expense), ev.expense.deletionVotes ?? []);
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
  if (olderEvents.length)     sections.push({ label: t('activity.section_older'), events: olderEvents });

  const todayNewCount = todayEvents.length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* La lupa que estaba acá arriba NO tenía onPress: era un ícono sin
            función. La reemplaza una barra que busca de verdad, entre el
            título y los filtros. */}
        <View style={styles.titleRow}>
          <Text style={[Typography.display, { color: c.text }]}>{t('activity.title')}</Text>
        </View>

        <View style={[styles.searchBar, { backgroundColor: c.surfaceSunken, borderColor: c.borderHair }]}>
          <Ionicons name="search-outline" size={16} color={c.textTertiary} />
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

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {allGroupNames.map(f => (
            <Pressable
              key={f}
              onPress={() => { hapticSelection(); setActiveFilter(f); }}
              style={[
                styles.chip,
                activeFilter === f
                  ? { backgroundColor: c.brand.primary, borderColor: c.brand.primary }
                  : { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: activeFilter === f ? '#fff' : c.textSecondary }}>
                {f === ALL_FILTER ? t('activity.filter_all') : f}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Empty state */}
        {feed.length === 0 ? (
          <EmptyState
            iconName="time-outline"
            title={t('activity.empty_title')}
            body={t('activity.empty_body')}
          />
        ) : filteredFeed.length === 0 ? (
          <View style={styles.emptyFilter}>
            <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center' }]}>
              {t('activity.no_filter_results', { name: activeFilter })}
            </Text>
          </View>
        ) : (
          /* Sections */
          sections.map(({ label, events }) => (
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
                <EventRow
                  key={i}
                  event={ev}
                  trust={marcaDeEvento(ev)}
                  getUserName={getUserName}
                  currentUserId={currentUser?.id ?? ''}
                  onRestore={restaurar}
                />
              ))}
            </View>
          ))
        )}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getTs(ev: ActivityKind): number {
  if (ev.kind === 'expense_added' || ev.kind === 'expense_delete_request') return ev.expense.date;
  // El borrado se ordena por CUÁNDO se borró, no por la fecha del gasto: si no,
  // un borrado de hoy sobre un gasto viejo quedaría enterrado al fondo del feed
  // y el usuario no lo vería a tiempo para deshacerlo.
  // Y lo restaurado, por cuándo volvió: es un evento de ahora sobre un gasto
  // que puede ser viejo.
  if (ev.kind === 'expense_deleted' || ev.kind === 'expense_restored') {
    return ev.expense.updatedAt || ev.expense.date;
  }
  return ev.payment.date;
}

function EventRow({
  event, trust, getUserName, currentUserId, onRestore,
}: {
  event: ActivityKind;
  /** Marca de T-041. `pendiente` = la cola todavía no llegó a esta fila. */
  trust: TrustState;
  onRestore: (expenseId: string) => void;
  getUserName: (id: string) => string;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  /**
   * La marca de la fila. Se dibuja debajo del texto, sin cambiar nada más: el
   * evento se muestra igual y el gasto sigue sumando al balance (R1).
   */
  const marca = isMarked(trust)
    ? <TrustMark label={t('trust.badge')} size="sm" testID={`trust-${event.kind}`} />
    : null;

  if (event.kind === 'expense_added') {
    const { expense, groupName } = event;
    const isMe   = expense.paidById === currentUserId;
    const who    = isMe ? t('common.you') : getUserName(expense.paidById);
    const action = isMe ? t('activity.action_registered_own') : t('activity.action_registered_other');
    const ts     = relativeTime(expense.date);

    return (
      <Pressable
        onPress={() => router.push(`/expense/${expense.id}` as any)}
        style={({ pressed }) => [styles.row, { paddingHorizontal: Spacing.screenPad, opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.rowIcon, { backgroundColor: '#0A6E8F' }]}>
          <Ionicons name="add-outline" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivityLine who={who} action={action} subject={`${expense.description} · ${groupName}`} ts={ts} />
          {marca}
        </View>
        <Text style={[Typography.amountM, { color: c.text }]}>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
      </Pressable>
    );
  }

  if (event.kind === 'expense_delete_request') {
    const { expense, groupName, requestedByName } = event;
    const ts = relativeTime(expense.deletionVotes?.[0]?.votedAt ?? expense.date);

    return (
      <View style={[styles.row, { backgroundColor: c.semantic.warningSoft, marginHorizontal: 12, borderRadius: Radius.md }]}>
        <View style={[styles.rowIcon, { backgroundColor: '#D4A24A' }]}>
          <Ionicons name="warning-outline" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivityLine
            who={requestedByName}
            action={t('activity.action_requested_delete')}
            subject={`“${expense.description}” · ${groupName}`}
            ts={ts}
          />
          {marca}
        </View>
      </View>
    );
  }

  if (event.kind === 'expense_deleted') {
    const { expense, groupName } = event;
    return (
      <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
        <View style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}>
          <Ionicons name="trash-outline" size={16} color={c.textTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[Typography.bodyM, { color: c.textSecondary, textDecorationLine: 'line-through' }]}
            numberOfLines={1}
          >
            {t('activity.deleted_title', { desc: expense.description })}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
            {groupName} · {relativeTime(expense.updatedAt || expense.date)}
          </Text>
          {marca}
        </View>
        <Pressable
          testID={`restore-${expense.id}`}
          accessibilityRole="button"
          onPress={() => onRestore(expense.id)}
          hitSlop={8}
          style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
          <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
            {t('activity.restore')}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (event.kind === 'expense_restored') {
    const { expense, groupName, restoredByName } = event;
    return (
      <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
        <View style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}>
          <Ionicons name="arrow-undo-outline" size={16} color={c.textTertiary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivityLine
            who={restoredByName}
            action={t('activity.action_restored')}
            subject={`“${expense.description}” · ${groupName}`}
            ts={relativeTime(expense.updatedAt || expense.date)}
          />
          {marca}
        </View>
      </View>
    );
  }

  // payment_made
  const { payment, groupName } = event;
  const isMe   = payment.fromUserId === currentUserId;
  const who    = isMe ? t('common.you') : getUserName(payment.fromUserId);
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
          {` ${t('activity.action_paid')} `}
          <Text style={{ fontWeight: '700' }}>{toName}</Text>
          <Text style={{ color: c.textSecondary }}> · {groupName}</Text>
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>{ts}</Text>
        {marca}
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
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  titleRow:      { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[3] },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[3],
    paddingHorizontal: 12, height: 40,
    borderRadius: Radius.md, borderWidth: 1,
  },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filters:       { paddingHorizontal: Spacing.screenPad, gap: 8, paddingBottom: Spacing[3] },
  chip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[2], paddingBottom: Spacing[1],
  },
  unseenBadge:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  row:           { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rowIcon:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emptyFilter:   { paddingVertical: Spacing[8], paddingHorizontal: Spacing.screenPad },
});
