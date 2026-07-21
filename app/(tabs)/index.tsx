import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from '@/src/components/Avatar';
import { Fab, FabRow } from '@/src/components/Fab';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';
import { Colors } from '@/src/constants/colors';
import { formatMoney } from '@/src/constants/currencies';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useAuthStore } from '@/src/store/authStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { useSyncStore } from '@/src/store/syncStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { hapticLight } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function AccountScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { state: syncState } = useSyncStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');
  const firstName = currentUser?.name?.split(' ')[0] ?? 'vos';

  // Personal budget summary for this month
  const { entries: personalEntries, budget } = usePersonalStore();
  const cur = budget.currency;
  const thisMonth = toMonthKey(Date.now());
  const monthEntries = personalEntries.filter(
    e => !e.isDeleted && e.currency === cur && toMonthKey(e.date) === thisMonth,
  );
  const totalSpent = monthEntries
    .filter(e => e.kind !== 'income')
    .reduce((s, e) => s + e.amount, 0);
  const totalIncome = monthEntries
    .filter(e => e.kind === 'income')
    .reduce((s, e) => s + e.amount, 0);
  const owedToMeInCur = personBalances
    .filter(b => b.currency === cur && b.amount > 0)
    .reduce((s, b) => s + b.amount, 0);
  const effectiveBudget =
    budget.monthlyAmount + totalIncome + (budget.includeOwedToMe ? owedToMeInCur : 0);
  const budgetPct = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget = budget.monthlyAmount > 0;

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
          <Avatar
            name={currentUser?.name ?? '?'}
            hue={hueForUser(currentUser?.id ?? '')}
            size={36}
          />
        </View>

        {/* Greeting */}
        <View style={styles.greeting}>
          <Text style={[Typography.bodyM, { color: c.textSecondary }]}>
            {t('dashboard.greeting', { name: firstName })}
          </Text>
          <Text style={[Typography.display, { color: c.text }]}>
            {t('dashboard.title')}
          </Text>
        </View>

        {/* Personal budget card */}
        <Pressable
          onPress={() => { hapticLight(); router.push('/(tabs)/personal' as any); }}
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderHair }]}
        >
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="analytics-outline" size={14} color={c.brand.primary} />
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 }]}>
                Personal · {new Date().toLocaleString('es-AR', { month: 'long' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
          </View>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>Saldo a favor</Text>
              <Text style={[Typography.amountM, { color: c.semantic.positive }]}>
                {formatMoney(owedToMeInCur, cur)}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>Gastado</Text>
              <Text style={[Typography.amountM, { color: c.text }]}>
                {formatMoney(totalSpent, cur)}
              </Text>
            </View>
            {hasBudget && (
              <>
                <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
                <View style={styles.stat}>
                  <Text style={[Typography.caption, { color: c.textTertiary }]}>Disponible</Text>
                  <Text style={[Typography.amountM, {
                    color: effectiveBudget - totalSpent >= 0 ? c.semantic.positive : c.semantic.negative,
                  }]}>
                    {formatMoney(Math.max(effectiveBudget - totalSpent, 0), cur)}
                  </Text>
                </View>
              </>
            )}
          </View>

          {hasBudget ? (
            <View style={[styles.barTrack, { backgroundColor: c.surfaceSunken }]}>
              <View style={[styles.barFill, {
                width: `${Math.round(budgetPct * 100)}%` as any,
                backgroundColor: budgetPct >= 1 ? c.semantic.negative
                  : budgetPct >= 0.8 ? c.semantic.warning
                  : c.semantic.positive,
              }]} />
            </View>
          ) : (
            <Text style={[Typography.caption, { color: c.brand.primary }]}>
              Configurar presupuesto →
            </Text>
          )}
        </Pressable>

        {/* Grupos balance card */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="wallet-outline" size={14} color={c.brand.primary} />
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 }]}>
                Grupos · Balance
              </Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.owed_to_you')}</Text>
              <Text style={[Typography.amountM, { color: c.semantic.positive }]}>
                {formatMoney(owedToYou, 'ARS')}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.you_owe')}</Text>
              <Text style={[Typography.amountM, { color: c.semantic.negative }]}>
                {formatMoney(youOwe, 'ARS')}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>Neto</Text>
              <Text style={[Typography.amountM, {
                color: net >= 0 ? c.semantic.positive : c.semantic.negative,
              }]}>
                {net >= 0 ? '+' : ''}{formatMoney(net, 'ARS')}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction
            iconName="card-outline"
            iconBg={c.semantic.positiveSoft}
            iconColor={c.semantic.positive}
            label={t('dashboard.register_payment')}
            sub={t('dashboard.register_payment_sub')}
            onPress={() => router.push('/settle/new' as any)}
          />
          <QuickAction
            iconName="qr-code-outline"
            iconBg={c.brand.primarySoft}
            iconColor={c.brand.primary}
            label={t('dashboard.join_group')}
            sub={t('dashboard.join_group_sub')}
            onPress={() => {}}
          />
        </View>

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

      {/* FAB */}
      <FabRow>
        <Fab
          onPress={() => router.push('/expense/new')}
          icon="add"
          label={t('dashboard.add_expense')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>
    </SafeAreaView>
  );
}

function QuickAction({
  iconName, iconBg, iconColor, label, sub, onPress,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string; iconColor: string;
  label: string; sub: string;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [styles.quickCard, { backgroundColor: c.surface, borderColor: c.borderHair, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={[styles.quickIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '700' }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  scroll:    { paddingTop: Spacing[2] },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  greeting:  { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[5], gap: 2 },
  card:        {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.xl, borderWidth: 1,
    padding: Spacing[4], gap: 12,
  },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statRow:     { flexDirection: 'row', alignItems: 'center' },
  stat:        { flex: 1, alignItems: 'center', gap: 3 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: 4 },
  quickRow:  {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
  },
  quickCard: {
    flex: 1, padding: 14, borderRadius: Radius.lg, borderWidth: 1,
    gap: 10,
  },
  quickIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  barTrack:    { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: 8, borderRadius: 4 },
});
