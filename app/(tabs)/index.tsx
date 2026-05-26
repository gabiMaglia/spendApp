import React from 'react';
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
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';

export default function AccountScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { state: syncState } = useSyncStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');
  const firstName = currentUser?.name?.split(' ')[0] ?? 'vos';

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

        {/* Balance hero */}
        <View style={[styles.heroCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <View style={styles.heroRow}>
            <View style={styles.heroCol}>
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                {t('dashboard.owed_to_you')}
              </Text>
              <Text style={[Typography.amountL, { color: c.semantic.positive, marginTop: 4 }]}>
                {formatMoney(owedToYou, 'ARS')}
              </Text>
            </View>
            <View style={[styles.heroDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.heroCol}>
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                {t('dashboard.you_owe')}
              </Text>
              <Text style={[Typography.amountL, { color: c.semantic.negative, marginTop: 4 }]}>
                {formatMoney(youOwe, 'ARS')}
              </Text>
            </View>
          </View>
          <View style={[styles.netRow, { borderTopColor: c.borderHair }]}>
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>Balance neto</Text>
            <Text style={[Typography.amountM, {
              color: net >= 0 ? c.semantic.positive : c.semantic.negative,
            }]}>
              {net >= 0 ? '+' : ''}{formatMoney(net, 'ARS')}
            </Text>
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
      onPress={onPress}
      style={[styles.quickCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}
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
  heroCard:  {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.xl, borderWidth: 1, overflow: 'hidden',
  },
  heroRow:   { flexDirection: 'row', padding: Spacing[5] },
  heroCol:   { flex: 1, alignItems: 'center' },
  heroDivider: { width: 1, alignSelf: 'stretch', marginVertical: 4 },
  netRow:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[5], paddingVertical: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
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
  fab:       {
    position: 'absolute', right: 20, bottom: 90,
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    shadowColor: '#0A6E8F', shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
