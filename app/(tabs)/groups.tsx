import React, { useMemo } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useSyncStore } from '@/src/store/syncStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupBalance, useGroupExpenseCount, useGroupsTotalBalance } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { GroupCard } from '@/src/components/GroupCard';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';
import { EmptyState } from '@/src/components/EmptyState';
import { hapticLight } from '@/src/utils/haptics';
import { Button } from '@/src/components/Button';
import type { Group } from '@/src/types/models';

export default function GroupsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { state: syncState } = useSyncStore();
  const { currentUser } = useAuthStore();
  const allGroups   = useGroupStore(s => s.groups);
  const groupTotals = useGroupsTotalBalance(currentUser?.id ?? '');

  const arsTotals = groupTotals.find(t => t.currency === 'ARS');
  const owedToYou = arsTotals?.owedToYou ?? 0;
  const youOwe    = arsTotals?.youOwe    ?? 0;

  const myGroups = useMemo(
    () => allGroups.filter(g => !g.isDeleted && (!currentUser || g.memberIds.includes(currentUser.id))),
    [allGroups, currentUser],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <SyncStatusBadge state={syncState} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => router.push('/sync' as any)}
              style={[styles.addButton, { backgroundColor: c.surfaceSunken }]}
            >
              <Ionicons name="sync-outline" size={18} color={c.text} />
            </Pressable>
            <Pressable
              onPress={() => { hapticLight(); router.push('/groups/new' as any); }}
              style={[styles.addButton, { backgroundColor: c.surfaceSunken }]}
            >
              <Ionicons name="add" size={20} color={c.text} />
            </Pressable>
          </View>
        </View>
        <View style={styles.titleRow}>
          <Text style={[Typography.display, { color: c.text }]}>{t('groups.title')}</Text>
        </View>

        {/* Balance summary */}
        {myGroups.length > 0 && (
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
                  {myGroups.length}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Filter tabs */}
        <View style={styles.section}>
          <View style={[styles.segmented, { backgroundColor: c.surfaceSunken }]}>
            <View style={[styles.segTab, { backgroundColor: c.surface }]}>
              <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600' }]}>{t('groups.tab_active')}</Text>
            </View>
            <Pressable style={styles.segTab}>
              <Text style={[Typography.bodyS, { color: c.textSecondary, fontWeight: '600' }]}>{t('groups.tab_archived')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Group list */}
        {myGroups.length === 0 ? (
          <EmptyState
            iconName="people-outline"
            title={t('groups.empty_title')}
            body={t('groups.empty_body')}
            action={
              <Button variant="primary" onPress={() => {}}>
                {t('groups.new_group')}
              </Button>
            }
          />
        ) : (
          <View style={[styles.list, styles.section]}>
            {myGroups.map(g => (
              <GroupRow
                key={g.id}
                group={g}
                currentUserId={currentUser?.id ?? ''}
                onPress={() => router.push(`/groups/${g.id}` as any)}
              />
            ))}
          </View>
        )}

        {/* P2P info banner */}
        <View style={[styles.section, styles.infoBanner, { backgroundColor: c.brand.accentSoft }]}>
          <View style={[styles.infoIcon, { backgroundColor: c.brand.accent }]}>
            <Ionicons name="sync-outline" size={16} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[Typography.bodyM, { color: c.brand.accentOnSoft, fontWeight: '600' }]}>
              {t('groups.p2p_banner_title')}
            </Text>
            <Text style={[Typography.bodyS, { color: c.brand.accentOnSoft, opacity: 0.85, marginTop: 2 }]}>
              {t('groups.p2p_banner_body')}
            </Text>
          </View>
        </View>

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => { hapticLight(); router.push('/groups/new' as any); }}
        style={[styles.fab, { backgroundColor: c.brand.primary }]}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
          {t('groups.new_group')}
        </Text>
      </Pressable>
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
  infoBanner:{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderRadius: Radius.md, padding: 14 },
  infoIcon:  { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  fab:       {
    position: 'absolute', right: 20, bottom: 90,
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    boxShadow: '0 8px 24px rgba(10,110,143,0.35)',
  },
});
