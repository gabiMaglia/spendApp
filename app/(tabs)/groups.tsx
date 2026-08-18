import React, { useMemo, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
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
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupBalance, useGroupExpenseCount, useGroupsTotalBalance } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { GroupCard } from '@/src/components/GroupCard';
import { SwipeToArchive } from '@/src/components/SwipeToArchive';
import { EmptyState } from '@/src/components/EmptyState';
import { hapticLight } from '@/src/utils/haptics';
import type { Group } from '@/src/types/models';

export default function GroupsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const allGroups   = useGroupStore(s => s.groups);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  const setArchived = useArchiveStore(s => s.setArchived);
  const groupTotals = useGroupsTotalBalance(currentUser?.id ?? '');

  const arsTotals = groupTotals.find(t => t.currency === 'ARS');
  const owedToYou = arsTotals?.owedToYou ?? 0;
  const youOwe    = arsTotals?.youOwe    ?? 0;

  const myGroups = useMemo(
    () => allGroups.filter(g => !g.isDeleted && (!currentUser || g.memberIds.includes(currentUser.id))),
    [allGroups, currentUser],
  );

  const [tabActual, setTab] = useState<'activos' | 'archivados'>('activos');

  const visibles = useMemo(
    () => myGroups.filter(g => archivedIds.includes(g.id) === (tabActual === 'archivados')),
    [myGroups, archivedIds, tabActual],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header. Único punto de entrada para crear un grupo: antes había tres
            (éste, el del estado vacío —que no hacía nada— y el FAB). */}
        <View style={[styles.header, { justifyContent: 'flex-end' }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { hapticLight(); router.push('/groups/new' as any); }}
            style={[styles.addButton, { backgroundColor: c.surfaceSunken }]}
          >
            <Ionicons name="add" size={20} color={c.text} />
          </Pressable>
        </View>
        <View style={styles.titleRow}>
          <Text style={[Typography.display, { color: c.text }]}>{t('groups.title')}</Text>
        </View>

        {/* Balance summary */}
        {visibles.length > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCol}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  Te deben
                </Text>
                <Text style={[Typography.amountM, { color: c.semantic.positive, marginTop: 2 }]}>
                  {formatMoney(owedToYou, 'ARS')}
                </Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: c.borderHair }]} />
              <View style={styles.summaryCol}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  Debés
                </Text>
                <Text style={[Typography.amountM, { color: c.semantic.negative, marginTop: 2 }]}>
                  {formatMoney(youOwe, 'ARS')}
                </Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: c.borderHair }]} />
              <View style={styles.summaryCol}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  Grupos
                </Text>
                <Text style={[Typography.amountM, { color: c.text, marginTop: 2 }]}>
                  {visibles.length}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Pestañas. Estaban dibujadas pero no filtraban nada. */}
        <View style={styles.section}>
          <View style={[styles.segmented, { backgroundColor: c.surfaceSunken }]}>
            {(['activos', 'archivados'] as const).map(tab => (
              <Pressable
                key={tab}
                accessibilityRole="button"
                onPress={() => { hapticLight(); setTab(tab); }}
                style={[styles.segTab, tab === tabActual && { backgroundColor: c.surface }]}
              >
                <Text style={[Typography.bodyS, {
                  color: tab === tabActual ? c.text : c.textSecondary, fontWeight: '600',
                }]}>
                  {tab === 'activos' ? t('groups.tab_active') : t('groups.tab_archived')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Group list */}
        {visibles.length === 0 ? (
          <EmptyState
            iconName={tabActual === 'archivados' ? 'archive-outline' : 'people-outline'}
            title={tabActual === 'archivados' ? t('groups.empty_archived_title') : t('groups.empty_title')}
            body={tabActual === 'archivados' ? t('groups.empty_archived_body') : t('groups.empty_body')}
          />
        ) : (
          <View style={[styles.list, styles.section]}>
            {visibles.map(g => (
              <SwipeToArchive
                key={g.id}
                archived={tabActual === 'archivados'}
                onAction={() => setArchived(g.id, tabActual === 'activos')}
              >
                <GroupRow
                  group={g}
                  currentUserId={currentUser?.id ?? ''}
                  onPress={() => router.push(`/groups/${g.id}` as any)}
                />
              </SwipeToArchive>
            ))}
          </View>
        )}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

    </SafeAreaView>
  );
}

function GroupRow({
  group, currentUserId, onPress,
}: {
  group: Group;
  currentUserId: string;
  onPress: () => void;
}) {
  const { getUserName } = useUserStore();
  const balances     = useGroupBalance(group.id, currentUserId);
  const expenseCount = useGroupExpenseCount(group.id);

  // Balance principal en la moneda del grupo
  const mainBalance = balances.find(b => b.currency === group.currency)?.amount ?? 0;

  const members = group.memberIds.map(id => ({
    name: getUserName(id),
    hue: hueForUser(id),
  }));

  return (
    <GroupCard
      name={group.name}
      members={members}
      balance={mainBalance}
      currency={group.currency}
      subtitle={`${expenseCount} gastos`}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  scroll:    { paddingTop: Spacing[2] },
  header:    {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  titleRow:  { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[3] },
  addButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  section:   { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: Radius.md, gap: 2 },
  segTab:    { flex: 1, height: 32, paddingHorizontal: 14, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  summaryCard:    {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[4],
  },
  summaryRow:     { flexDirection: 'row', alignItems: 'center' },
  summaryCol:     { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 36, marginHorizontal: 4 },
  list:      { gap: Spacing.cardGap },
  infoBanner:{
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.md, padding: 14,
  },
  infoIcon:  { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
