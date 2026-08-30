import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from '@/src/components/Avatar';
import { Fab, FabRow } from '@/src/components/Fab';
import { Colors } from '@/src/constants/colors';
import { MoneyText } from '@/src/components/MoneyText';
import i18n from '@/src/i18n';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useAuthStore } from '@/src/store/authStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useFx } from '@/src/store/useFx';
import { convertMinor } from '@/src/services/fx';
import { sumConverted } from '@/src/services/fxTotals';
import { UnconvertedNotice } from '@/src/components/UnconvertedNotice';
import { hueForUser } from '@/src/utils/hueForUser';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { hapticLight } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AccountScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');
  const firstName = currentUser?.name?.split(' ')[0] ?? 'vos';

  // Personal budget summary for this month
  const { entries: personalEntries, budget } = usePersonalStore();

  // La moneda la elige el usuario en el menú, ya no la fija el presupuesto.
  // Antes `cur` era `budget.currency` y todo lo que no coincidiera se
  // descartaba EN SILENCIO: un gasto en reales daba 0 sin ninguna señal.
  const { fx, display: cur } = useFx();

  const thisMonth = toMonthKey(Date.now());
  const monthEntries = personalEntries.filter(
    e => !e.isDeleted && toMonthKey(e.date) === thisMonth,
  );

  const gastos = sumConverted(
    monthEntries.filter(e => e.kind !== 'income').map(e => ({ currency: e.currency, minor: e.amount })),
    cur, fx,
  );
  const ingresos = sumConverted(
    monthEntries.filter(e => e.kind === 'income').map(e => ({ currency: e.currency, minor: e.amount })),
    cur, fx,
  );
  const aFavor = sumConverted(
    personBalances.filter(b => b.amount > 0).map(b => ({ currency: b.currency, minor: b.amount })),
    cur, fx,
  );

  const totalSpent    = gastos.totalMinor;
  const totalIncome   = ingresos.totalMinor;
  const owedToMeInCur = aFavor.totalMinor;

  // Lo que no se pudo convertir. Mientras haya algo acá, los números de arriba
  // son verdaderos pero PARCIALES, y eso hay que decirlo (ver el modal).
  const pendientes = gastos.unconverted;
  const [avisoVisto, setAvisoVisto] = useState(false);
  const effectiveBudget =
    (convertMinor(budget.monthlyAmount, budget.currency, cur, fx) ?? 0)
    + totalIncome + (budget.includeOwedToMe ? owedToMeInCur : 0);
  const budgetPct = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget = budget.monthlyAmount > 0;

  // Antes filtraba `p.currency === 'ARS'` LITERAL: cualquiera cuyos grupos no
  // fueran en pesos argentinos veía 0 para siempre en «te deben» y «debés».
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          {/* El avatar lleva al perfil "Yo" (decisión PO). */}
          <Pressable
            onPress={() => { hapticLight(); router.push('/(tabs)/user' as any); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('dashboard.go_to_profile')}
          >
            <Avatar
              name={currentUser?.name ?? '?'}
              hue={hueForUser(currentUser?.id ?? '')}
              size={36}
            />
          </Pressable>
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
                {t('dashboard.personal_label')} · {new Date().toLocaleString(i18n.language, { month: 'long' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
          </View>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.balance_favor')}</Text>
              <MoneyText minor={owedToMeInCur} code={cur} style={[Typography.amountM, { color: c.semantic.positive }]} />
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.spent')}</Text>
              {/* Rojo si hay deuda (gastos > ingresos); negro si los ingresos alcanzan (decisión PO). */}
              <MoneyText minor={totalSpent} code={cur} style={[Typography.amountM, {
                color: totalIncome >= totalSpent ? c.text : c.semantic.negative,
              }]} />
            </View>
            {hasBudget && (
              <>
                <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
                <View style={styles.stat}>
                  <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.available')}</Text>
                  <MoneyText minor={Math.max(effectiveBudget - totalSpent, 0)} code={cur} style={[Typography.amountM, {
                    color: effectiveBudget - totalSpent >= 0 ? c.semantic.positive : c.semantic.negative,
                  }]} />
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
              {t('dashboard.set_budget')}
            </Text>
          )}
        </Pressable>

        {/* El total de arriba es verdadero pero PARCIAL mientras haya monedas
            sin cotización. El aviso salta solo la primera vez y esta fila
            queda para volver a abrirlo: un número incompleto no puede quedar
            en pantalla sin que se note. */}
        {pendientes.length > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAvisoVisto(false)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 4, paddingVertical: 8,
            }}
          >
            <Ionicons name="alert-circle-outline" size={14} color={c.semantic.warning} />
            <Text style={[Typography.caption, { color: c.semantic.warning, fontWeight: '600' }]}>
              {t('fx.see_detail')}
            </Text>
          </Pressable>
        )}

        <UnconvertedNotice
          visible={pendientes.length > 0 && !avisoVisto}
          display={cur}
          unconverted={pendientes}
          onClose={() => setAvisoVisto(true)}
        />

        {/* Grupos balance card */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="wallet-outline" size={14} color={c.brand.primary} />
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 }]}>
                {t('dashboard.groups_balance')}
              </Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.owed_to_you')}</Text>
              <MoneyText minor={owedToYou} code="ARS" style={[Typography.amountM, { color: c.semantic.positive }]} />
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.you_owe')}</Text>
              <MoneyText minor={youOwe} code="ARS" style={[Typography.amountM, { color: c.semantic.negative }]} />
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.borderHair }]} />
            <View style={styles.stat}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('dashboard.net')}</Text>
              <MoneyText minor={net} code="ARS" prefix={net >= 0 ? '+' : ''} style={[Typography.amountM, {
                color: net >= 0 ? c.semantic.positive : c.semantic.negative,
              }]} />
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
