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
import { useUserStore } from '@/src/store/userStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';
import { EmptyState } from '@/src/components/EmptyState';

export default function FriendsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { state: syncState } = useSyncStore();
  const { currentUser } = useAuthStore();
  const { getUserName } = useUserStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');

  const owedToYou = personBalances
    .filter(p => p.currency === 'ARS' && p.amount > 0)
    .reduce((s, p) => s + p.amount, 0);
  const youOwe = Math.abs(
    personBalances
      .filter(p => p.currency === 'ARS' && p.amount < 0)
      .reduce((s, p) => s + p.amount, 0),
  );
  const net = owedToYou - youOwe;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <SyncStatusBadge state={syncState} />
          <Pressable style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}>
            <Ionicons name="search-outline" size={18} color={c.text} />
          </Pressable>
        </View>

        <Text style={[Typography.display, styles.title, { color: c.text }]}>Amigos</Text>

        {/* Balance summary */}
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
                Balance
              </Text>
              <Text style={[Typography.amountM, {
                color: net >= 0 ? c.semantic.positive : c.semantic.negative, marginTop: 2,
              }]}>
                {net >= 0 ? '+' : ''}{formatMoney(net, 'ARS')}
              </Text>
            </View>
          </View>
        </View>

        {/* Section label */}
        <View style={styles.sectionHeader}>
          <Text style={[Typography.label, { color: c.textTertiary }]}>POR PERSONA</Text>
        </View>

        {/* Friends list */}
        {personBalances.length === 0 ? (
          <EmptyState
            iconName="checkmark-circle-outline"
            title={t('dashboard.empty_title')}
            body={t('dashboard.empty_body')}
          />
        ) : (
          <View style={styles.list}>
            {personBalances.map(p => (
              <PersonRow
                key={`${p.userId}:${p.currency}`}
                userId={p.userId}
                name={getUserName(p.userId)}
                amount={p.amount}
                currency={p.currency}
              />
            ))}
          </View>
        )}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => router.push('/expense/new')}
        style={[styles.fab, { backgroundColor: c.brand.primary }]}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
          {t('dashboard.add_expense')}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

function PersonRow({
  userId, name, amount, currency,
}: {
  userId: string; name: string; amount: number; currency: string;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const positive = amount > 0;
  const settled  = amount === 0;

  return (
    <Pressable style={[styles.personRow, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <Avatar name={name} hue={hueForUser(userId)} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>{name}</Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
          {currency}
        </Text>
      </View>
      {settled ? (
        <View style={[styles.settledBadge, { backgroundColor: c.surfaceSunken }]}>
          <Text style={[Typography.caption, { color: c.textTertiary, fontWeight: '600' }]}>
            {t('common.settled')}
          </Text>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[Typography.caption, {
            fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
            color: positive ? c.semantic.positive : c.semantic.negative,
          }]}>
            {positive ? t('dashboard.owes_you') : t('dashboard.you_owe_person')}
          </Text>
          <Text style={[Typography.amountM, {
            color: positive ? c.semantic.positive : c.semantic.negative,
          }]}>
            {formatMoney(Math.abs(amount), currency as any)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  scroll:        { paddingTop: Spacing[2] },
  header:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title:         { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  summaryCard:   {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1,
    padding: Spacing[4],
  },
  summaryRow:    { flexDirection: 'row', alignItems: 'center' },
  summaryCol:    { flex: 1, alignItems: 'center' },
  summaryDivider:{ width: 1, height: 36, marginHorizontal: 4 },
  sectionHeader: {
    paddingHorizontal: Spacing.screenPad,
    marginBottom: Spacing[2],
  },
  list:          { paddingHorizontal: Spacing.screenPad, gap: Spacing.cardGap },
  personRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: Spacing.cardPad, borderRadius: Radius.lg, borderWidth: 1,
  },
  settledBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  fab:           {
    position: 'absolute', right: 20, bottom: 90,
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    shadowColor: '#0A6E8F', shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
