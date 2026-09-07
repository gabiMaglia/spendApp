import { useColorScheme } from '@/hooks/use-color-scheme';
import { Fab, FabRow } from '@/src/components/Fab';
import { Colors } from '@/src/constants/colors';
import { MoneyText } from '@/src/components/MoneyText';
import { formatMoney } from '@/src/constants/currencies';
import i18n from '@/src/i18n';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, BandLink, Meter, SectionLabel, SplitStat } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding } from '@/src/components/CollapsibleHeader';
import { GroupCard } from '@/src/components/GroupCard';
import { useAuthStore } from '@/src/store/authStore';
import { useGlobalPersonBalances, useGroupBalance, useGroupExpenseCount } from '@/src/store/selectors';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { useFx } from '@/src/store/useFx';
import { convertMinor } from '@/src/services/fx';
import { sumConverted } from '@/src/services/fxTotals';
import type { PersonalEntry, Group } from '@/src/types/models';
import {
  repartirDelMes, BALDES_GASTADOS, BALDES_DISPONIBLES, type BucketPersonal,
} from '@/src/algorithms/personalMonth';
import { UnconvertedNotice } from '@/src/components/UnconvertedNotice';
import { useGroupStore } from '@/src/store/groupStore';
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { hapticLight } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { esYo } from '@/src/store/identityAlias';

export default function AccountScreen() {
  const { t } = useTranslation();
  const headerPad = useHeaderPadding();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');
  const firstName = currentUser?.name?.split(' ')[0] ?? 'vos';

  const { entries: personalEntries, budget } = usePersonalStore();
  const { fx, display: cur } = useFx();

  const scrollY = useRef(new Animated.Value(0)).current;

  const thisMonth = toMonthKey(Date.now());
  const monthEntries = personalEntries.filter(
    e => !e.isDeleted && toMonthKey(e.date) === thisMonth,
  );

  const baldes = repartirDelMes(monthEntries);
  const aMonto = (e: PersonalEntry) => ({ currency: e.currency, minor: e.amount });
  const deBaldes = (cuales: readonly BucketPersonal[]) =>
    sumConverted(cuales.flatMap(b => baldes[b]).map(aMonto), cur, fx);

  const gastos   = deBaldes(BALDES_GASTADOS);
  const ingresos = deBaldes(BALDES_DISPONIBLES);
  const aFavor = sumConverted(
    personBalances.filter(b => b.amount > 0).map(b => ({ currency: b.currency, minor: b.amount })),
    cur, fx,
  );

  const totalSpent      = gastos.totalMinor;
  const totalAcreditado = ingresos.totalMinor;
  const owedToMeInCur   = aFavor.totalMinor;

  const pendientes    = gastos.unconverted;
  const pendientesFav = aFavor.unconverted;
  const [avisoVisto, setAvisoVisto] = useState(false);

  const groups = useGroupStore(st => st.groups);

  const misGrupos = useMemo(
    () => groups.filter(g => !g.isDeleted && !!currentUser && g.memberIds.some(esYo)),
    [groups, currentUser],
  );


  const effectiveBudget =
    (convertMinor(budget.monthlyAmount, budget.currency, cur, fx) ?? 0)
    + totalAcreditado + (budget.includeOwedToMe ? owedToMeInCur : 0);
  const budgetPct = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget = budget.monthlyAmount > 0;

  const deben = sumConverted(
    personBalances.filter(p => p.amount > 0).map(p => ({ currency: p.currency, minor: p.amount })),
    cur, fx,
  );
  const debo = sumConverted(
    personBalances.filter(p => p.amount < 0).map(p => ({ currency: p.currency, minor: -p.amount })),
    cur, fx,
  );
  const owedToYou = deben.totalMinor;
  const youOwe    = debo.totalMinor;
  const net = owedToYou - youOwe;

  const barColor = budgetPct >= 1 ? c.semantic.negative
    : budgetPct >= 0.8 ? c.semantic.warning
    : c.brand.primary;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 150 }}
      >
        {/* Saludo + título: scrollean, el header los recoge en compacto */}
        <View style={styles.greeting}>
          <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
            {t('dashboard.greeting', { name: firstName })}
          </Text>
          <Text style={[Typography.display, { color: c.text }]}>{t('dashboard.title')}</Text>
        </View>

        {/* Banda de deuda direccional: los dos lados no se netean (ADR-006) */}
        <SplitStat
          items={[
            { label: t('friends.owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive },
            { label: t('friends.you_owe'),     value: formatMoney(youOwe, cur),    color: c.textSecondary },
          ]}
        />

        {/* Fila de neto */}
        <Band sunken>
          <Pressable
            accessibilityRole="button"
            testID="groups-card"
            onPress={() => { hapticLight(); router.push('/(tabs)/groups' as any); }}
            style={styles.netRow}
          >
            <Text style={[Typography.caption, { color: c.textSecondary, flex: 1 }]}>
              {t('dashboard.groups_balance')} ·{' '}
              {misGrupos.length === 1
                ? t('dashboard.groups_count_one')
                : t('dashboard.groups_count', { count: misGrupos.length })}
            </Text>
            <MoneyText
              minor={net}
              code={cur}
              prefix={net > 0 ? '+' : ''}
              style={[Typography.amountS, {
                color: net > 0 ? c.semantic.positive : net < 0 ? c.semantic.negative : c.text,
              }]}
            />
          </Pressable>
        </Band>

        {/* Personal del mes */}
        <SectionLabel
          label={`${t('dashboard.personal_label')} · ${new Date().toLocaleString(i18n.language, { month: 'long' })}`}
          right={<BandLink label={t('dashboard.see_month')} onPress={() => router.push('/(tabs)/personal' as any)} />}
        />
        <Band>
          <Pressable
            onPress={() => { hapticLight(); router.push('/(tabs)/personal' as any); }}
            style={styles.personalPad}
          >
            <View style={styles.personalTop}>
              <MoneyText
                minor={totalSpent}
                code={cur}
                style={[Typography.amountL, {
                  color: totalAcreditado >= totalSpent ? c.text : c.semantic.negative,
                }]}
              />
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('dashboard.spent')}
              </Text>
            </View>

            {hasBudget ? (
              <>
                <View style={{ marginTop: 13, marginBottom: 9 }}>
                  <Meter pct={budgetPct} color={barColor} height={4} />
                </View>
                <Text style={[Typography.caption, { color: c.textTertiary }]}>
                  {t('dashboard.available')}{' '}
                  {formatMoney(Math.max(effectiveBudget - totalSpent, 0), cur)} · {formatMoney(effectiveBudget, cur)}
                </Text>
              </>
            ) : (
              <Text style={[Typography.caption, { color: c.brand.primary, marginTop: 10, fontWeight: '700' }]}>
                {t('dashboard.set_budget')}
              </Text>
            )}
          </Pressable>
        </Band>

        <UnconvertedNotice
          visible={(pendientes.length > 0 || pendientesFav.length > 0) && !avisoVisto}
          display={cur}
          unconverted={pendientes}
          owed={pendientesFav}
          onClose={() => setAvisoVisto(true)}
        />

        {/* Grupos */}
        <SectionLabel
          label={t('tabs.groups')}
          right={<BandLink label={t('groups.new_group')} onPress={() => router.push('/groups/new' as any)} />}
        />
        {misGrupos.length > 0 && (
          <Band>
            {misGrupos.map((g, i) => (
              <HomeGroupRow
                key={g.id}
                group={g}
                currentUserId={currentUser?.id ?? ''}
                last={i === misGrupos.length - 1}
                onPress={() => router.push(`/groups/${g.id}` as any)}
              />
            ))}
          </Band>
        )}
      </Animated.ScrollView>

      <TabHeader title={t('dashboard.title')} scrollY={scrollY} />

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

/** Fila de grupo del home: resuelve su propio balance y conteo de gastos. */
function HomeGroupRow({
  group, currentUserId, onPress, last,
}: { group: Group; currentUserId: string; onPress: () => void; last?: boolean }) {
  const balances     = useGroupBalance(group.id, currentUserId);
  const expenseCount = useGroupExpenseCount(group.id);
  const mainBalance  = balances.find(b => b.currency === group.currency)?.amount ?? 0;
  return (
    <GroupCard
      name={group.name}
      memberIds={group.memberIds}
      balance={mainBalance}
      currency={group.currency}
      subtitle={`${expenseCount} gastos`}
      onPress={onPress}
      last={last}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  greeting: { paddingHorizontal: Spacing.screenPad, paddingBottom: 18, gap: 1 },
  netRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 11,
  },
  personalPad: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, paddingBottom: 16 },
  personalTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
});
