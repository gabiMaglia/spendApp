import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TabHeader } from '@/src/components/TabHeader';
import {
  Alert, Animated, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { MoneyText } from '@/src/components/MoneyText';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { Fab, FabRow } from '@/src/components/Fab';
import {
  Band, BandRow, Meter, SectionLabel, SplitStat, StatLead,
} from '@/src/components/Band';
import { useHeaderPadding } from '@/src/components/CollapsibleHeader';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore, toMonthKey, currentMonthKey } from '@/src/store/personalStore';
import { reasonKey } from '@/src/algorithms/entryOrigin';
import { useDirectedDebts, useGlobalPersonBalances } from '@/src/store/selectors';
import { hapticLight, hapticSelection, hapticWarning } from '@/src/utils/haptics';
import { v4 as uuidv4 } from 'uuid';
import { BottomSheet } from '@/src/components/Sheet';
import type { PersonalEntry } from '@/src/types/models';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import { totalIOwe, totalOwedToMe } from '@/src/algorithms/directedDebts';
import { repartirDelMes, type BucketPersonal } from '@/src/algorithms/personalMonth';
import { useFx } from '@/src/store/useFx';
import { UnconvertedNotice } from '@/src/components/UnconvertedNotice';
import { sumConverted } from '@/src/services/fxTotals';
import { syncedNow } from '@/src/utils/syncedClock';

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  const s = d.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prevMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 2, 1);
  return toMonthKey(d.getTime());
}

function nextMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month, 1);
  return toMonthKey(d.getTime());
}

const ENTRY_KIND_META = {
  expense:         { icon: 'trending-down-outline' as const, labelKey: 'personal.kind_expense' },
  income:          { icon: 'trending-up-outline'   as const, labelKey: 'personal.kind_income' },
  group_replicated:{ icon: 'people-outline'        as const, labelKey: 'personal.kind_group' },
  carryover:       { icon: 'refresh-outline'       as const, labelKey: 'personal.kind_carryover' },
};

export default function PersonalScreen() {
  const scheme = useColorScheme() ?? 'light';
  const headerPad = useHeaderPadding();
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { entries, budget, removeEntry, setBudget, lastSeenMonth } = usePersonalStore();
  useGlobalPersonBalances(currentUser?.id ?? '');

  const today = toMonthKey(Date.now());
  const [activeMonth, setActiveMonth] = useState(today);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [includeOwedToMe, setIncludeOwedToMe] = useState(budget.includeOwedToMe);
  const [budgetCurrency] = useState<CurrencyCode>(budget.currency);
  const {
    text: budgetInput,
    minor: budgetAmount,
    onChangeText: setBudgetInput,
    onBlur: onBudgetInputBlur,
  } = useAmountInput(budgetCurrency, budget.monthlyAmount);

  /** Scroll del header colapsable. */
  const scrollY = useRef(new Animated.Value(0)).current;

  const { fx, display: cur } = useFx();
  const [avisoVisto, setAvisoVisto] = useState(false);

  const deudas = useDirectedDebts(currentUser?.id ?? '');
  const owedToMe = useMemo(() => totalOwedToMe(deudas, cur), [deudas, cur]);
  const youOwe   = useMemo(() => totalIOwe(deudas, cur), [deudas, cur]);

  const owedToMeRef = useRef(owedToMe);
  useEffect(() => { owedToMeRef.current = owedToMe; }, [owedToMe]);

  // Month-rollover: sin cambios respecto del original (ADR-005/006).
  useEffect(() => {
    const thisMonth = currentMonthKey();
    if (!lastSeenMonth || lastSeenMonth >= thisMonth) return;

    const { entries: allEntries, budget: curBudget, addEntry: add, setLastSeenMonth: setSeen } =
      usePersonalStore.getState();
    const cy = curBudget.currency;

    const alreadyCarried = allEntries.some(
      e => !e.isDeleted && e.kind === 'carryover' && toMonthKey(e.date) === thisMonth,
    );
    if (alreadyCarried) { setSeen(thisMonth); return; }

    const prevEntries = allEntries.filter(
      e => !e.isDeleted && e.currency === cy && toMonthKey(e.date) === lastSeenMonth,
    );

    const prevIncome   = prevEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
    const prevExpense  = prevEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
    const prevGroup    = prevEntries.filter(e => e.kind === 'group_replicated').reduce((s, e) => s + e.amount, 0);
    const prevPosCarry = prevEntries.filter(e => e.kind === 'carryover' && e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);
    const prevNegCarry = prevEntries.filter(e => e.kind === 'carryover' && !e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);

    const prevEffective = curBudget.monthlyAmount + prevIncome + prevPosCarry +
      (curBudget.includeOwedToMe ? owedToMeRef.current : 0);
    const prevSpent     = prevExpense + prevGroup + prevNegCarry;
    const prevRemaining = prevEffective - prevSpent;

    if (Math.abs(prevRemaining) >= 0.01) {
      const firstOfMonth = new Date(`${thisMonth}-01T12:00:00`).getTime();
      add({
        id:                  uuidv4(),
        kind:                'carryover',
        isPositiveCarryover: prevRemaining > 0,
        description:         `Saldo de ${monthLabel(lastSeenMonth)}`,
        amount:              Math.abs(prevRemaining),
        currency:            cy,
        category:            'other',
        date:                firstOfMonth,
        createdAt:           Date.now(),
        updatedAt:           syncedNow(),
        isDeleted:           false,
      });
    }

    setSeen(thisMonth);
  }, [lastSeenMonth]);

  const monthEntries = useMemo(
    () => entries.filter(e => !e.isDeleted && toMonthKey(e.date) === activeMonth),
    [entries, activeMonth],
  );

  const sumar = (pred: (e: PersonalEntry) => boolean) =>
    sumConverted(
      monthEntries.filter(pred).map(e => ({ currency: e.currency, minor: e.amount })),
      cur, fx,
    );

  const baldes   = repartirDelMes(monthEntries);
  const porBalde = (b: BucketPersonal) => sumar(e => baldes[b].includes(e));
  const income   = porBalde('income');
  const expense  = porBalde('expense');
  const group    = porBalde('group');
  const carryPos = porBalde('carryPos');
  const carryNeg = porBalde('carryNeg');

  const totalIncome       = income.totalMinor;
  const totalExpense      = expense.totalMinor;
  const totalGroup        = group.totalMinor;
  const positiveCarryover = carryPos.totalMinor;
  const negativeCarryover = carryNeg.totalMinor;
  const totalSpent        = totalExpense + totalGroup + negativeCarryover;

  const pendientes = [...expense.unconverted, ...group.unconverted];

  const baseBudget      = budget.monthlyAmount;
  const effectiveBudget = baseBudget + totalIncome + positiveCarryover + (budget.includeOwedToMe ? owedToMe : 0);
  const remaining       = effectiveBudget - totalSpent;
  const pct             = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget       = baseBudget > 0;

  const barColor = pct >= 1 ? c.semantic.negative
    : pct >= 0.8 ? c.semantic.warning
    : c.brand.primary;

  const atCurrentMonth = activeMonth >= today;

  function handleSaveBudget() {
    setBudget({ currency: budgetCurrency, monthlyAmount: budgetAmount, includeOwedToMe });
    hapticLight();
    setShowBudgetSheet(false);
  }

  function handleRemove(entry: PersonalEntry) {
    const motivo = reasonKey(entry);
    if (motivo) {
      hapticWarning();
      Alert.alert(t('personal.locked_title'), t(motivo));
      return;
    }
    hapticWarning();
    Alert.alert(
      t('personal.remove_title'),
      t('personal.remove_body', { desc: entry.description }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeEntry(entry.id) },
      ],
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 140 }}
      >
        {/* Título grande: vive en el contenido y scrollea; el header lo recoge. */}
        <View style={styles.titleRow}>
          <Text style={[Typography.display, { color: c.text }]}>{t('personal.title')}</Text>
          <Pressable
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.iconBtn, { backgroundColor: c.bgGrouped }]}
          >
            <Ionicons name="settings-outline" size={17} color={c.textSecondary} />
          </Pressable>
        </View>

        {/* Navegador de mes */}
        <View style={styles.monthNav}>
          <Pressable onPress={() => { hapticSelection(); setActiveMonth(prevMonth(activeMonth)); }} hitSlop={12}>
            <Ionicons name="chevron-back" size={19} color={c.textSecondary} />
          </Pressable>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>
            {monthLabel(activeMonth)}
          </Text>
          <Pressable
            onPress={() => { hapticSelection(); setActiveMonth(nextMonth(activeMonth)); }}
            disabled={atCurrentMonth}
            hitSlop={12}
            style={{ opacity: atCurrentMonth ? 0.3 : 1 }}
          >
            <Ionicons name="chevron-forward" size={19} color={c.textSecondary} />
          </Pressable>
        </View>

        {/* Banda medidor */}
        {hasBudget ? (
          <Band>
            <View style={styles.meterPad}>
              <View style={styles.meterTop}>
                <View>
                  <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
                    {t('personal.spent')}
                  </Text>
                  <MoneyText minor={totalSpent} code={cur} style={[Typography.amountM, { color: c.text }]} />
                </View>
                <View style={{ alignItems: 'flex-end', flexShrink: 0, marginLeft: 16 }}>
                  <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
                    {remaining >= 0 ? t('personal.available') : t('personal.exceeded')}
                  </Text>
                  <MoneyText
                    minor={Math.abs(remaining)}
                    code={cur}
                    style={[Typography.amountM, { color: remaining >= 0 ? c.semantic.positive : c.semantic.negative }]}
                  />
                </View>
              </View>

              <View style={{ marginTop: 14, marginBottom: 10 }}>
                <Meter pct={pct} color={barColor} />
              </View>

              <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center' }]}>
                {t('personal.budget_progress', { pct: Math.round(pct * 100), amount: formatMoney(effectiveBudget, cur) })}
                {budget.includeOwedToMe && owedToMe > 0
                  ? t('personal.budget_includes_owed', { amount: formatMoney(owedToMe, cur) })
                  : ''}
              </Text>
            </View>
          </Band>
        ) : (
          <Band>
            <Pressable
              onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
              style={styles.meterEmpty}
            >
              <Ionicons name="bar-chart-outline" size={26} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
                {t('personal.budget_empty')}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand.primary }}>
                {t('personal.budget_configure')}
              </Text>
            </Pressable>
          </Band>
        )}

        {/* El ingreso a lo ancho y los dos gastos abajo (PO 2026-09-02). En una
            sola fila de tres, un ingreso y dos gastos se leen como comparables
            entre sí, y no lo son: los de abajo salen del de arriba. */}
        <StatLead
          sunken
          lead={{
            label: t('personal.summary_income'),
            value: `+${formatMoney(totalIncome, cur)}`,
            color: c.semantic.positive,
          }}
          items={[
            { label: t('personal.summary_personal'), value: formatMoney(totalExpense, cur) },
            { label: t('personal.summary_groups'),   value: formatMoney(totalGroup, cur) },
          ]}
        />

        {/* Deuda direccional: banda propia, nunca mezclada con lo gastado
            (ADR-006). Era un párrafo con los montos embebidos en la frase; el
            PO pidió una caja con los números afuera, y agregó el que faltaba:
            cuánto queda disponible DESPUÉS de pagar lo que se debe. Ese número
            es el que decide si podés gastar, y antes había que restarlo a mano. */}
        {youOwe > 0 ? (
          <SplitStat
            items={[
              ...(owedToMe > 0
                ? [{
                    label: t('personal.owed_to_me'),
                    value: formatMoney(owedToMe, cur),
                    color: c.semantic.positive,
                  }]
                : []),
              {
                label: t('personal.i_owe'),
                value: formatMoney(youOwe, cur),
                color: c.semantic.negative,
              },
              {
                label: t('personal.available_after_debts'),
                value: formatMoney(Math.abs(remaining - youOwe), cur),
                // En rojo cuando pagar lo que debés te deja en negativo: es
                // justamente el caso en el que el número importa.
                color: remaining - youOwe >= 0 ? c.semantic.positive : c.semantic.negative,
              },
            ]}
          />
        ) : owedToMe > 0 ? (
          <SplitStat
            items={[{
              label: t('personal.owed_to_me'),
              value: formatMoney(owedToMe, cur),
              color: c.semantic.positive,
            }]}
          />
        ) : null}

        {/* La aclaración sobrevive al párrafo que la contenía: la deuda NO
            afecta lo gastado hasta que se salda (ADR-006), y sin decirlo los
            números de arriba parecerían no cerrar. */}
        {(youOwe > 0 || owedToMe > 0) && (
          <Text style={[Typography.caption, styles.debtsNote, { color: c.textTertiary }]}>
            {t('personal.debts_note')}
          </Text>
        )}

        {pendientes.length > 0 && (
          <UnconvertedNotice
            visible={!avisoVisto}
            display={cur}
            unconverted={pendientes}
            onClose={() => setAvisoVisto(true)}
          />
        )}

        <SectionLabel label={t('personal.movements_count', { count: monthEntries.length })} />

        {monthEntries.length === 0 ? (
          <Band>
            <View style={styles.emptyBox}>
              <Ionicons name="receipt-outline" size={26} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8, textAlign: 'center' }]}>
                {t('personal.no_movements', { month: monthLabel(activeMonth) })}
              </Text>
            </View>
          </Band>
        ) : (
          <Band>
            {[...monthEntries].sort((a, b) => b.date - a.date).map((entry, i, arr) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                last={i === arr.length - 1}
                onRemove={() => handleRemove(entry)}
              />
            ))}
          </Band>
        )}
      </Animated.ScrollView>

      <TabHeader title={t('personal.title')} scrollY={scrollY} />

      <FabRow>
        <Fab
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense/new', params: { allowIncome: '1', kind: 'income' } } as any)}
          icon="trending-up-outline"
          label={t('personal.fab_income')}
          backgroundColor={c.semantic.positiveSoft}
          borderColor={c.hair}
          iconColor={c.semantic.positive}
          textColor={c.semantic.positive}
        />
        <Fab
          onPress={() => router.push({ pathname: '/expense/new', params: { allowIncome: '1' } } as any)}
          icon="add"
          label={t('personal.fab_expense')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>

      <BottomSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>{t('personal.budget_sheet_title')}</Text>
        <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
          {t('personal.budget_reset_note')}
        </Text>

        <Text style={[Typography.label, styles.upper, { color: c.textTertiary, marginBottom: 8 }]}>
          {t('personal.amount')}
        </Text>
        <View style={[styles.budgetInput, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
          <Text style={[Typography.bodyM, { color: c.textTertiary }]}>$</Text>
          <TextInput
            value={budgetInput}
            onChangeText={setBudgetInput}
            onBlur={onBudgetInputBlur}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={c.textTertiary}
            style={[Typography.bodyM, { flex: 1, color: c.text, padding: 0 }]}
            returnKeyType="done"
          />
        </View>

        <Pressable
          onPress={() => { hapticSelection(); setIncludeOwedToMe(v => !v); }}
          style={[styles.toggleRow, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyL, { color: c.text }]}>{t('personal.include_owed')}</Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>{t('personal.include_owed_sub')}</Text>
          </View>
          <View style={[styles.toggle, { backgroundColor: includeOwedToMe ? c.brand.primary : c.hair }]}>
            <View style={[styles.toggleKnob, includeOwedToMe && styles.toggleKnobOn]} />
          </View>
        </Pressable>

        <Pressable onPress={handleSaveBudget} style={[styles.saveBtn, { backgroundColor: c.brand.primary }]}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('personal.save_budget')}</Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
}

function EntryRow({
  entry, onRemove, last,
}: { entry: PersonalEntry; onRemove: () => void; last?: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];
  const meta = ENTRY_KIND_META[entry.kind];
  const isCarryover = entry.kind === 'carryover';
  const isPositive  = entry.kind === 'income' || (isCarryover && entry.isPositiveCarryover === true);
  const isReadOnly  = entry.kind === 'group_replicated' || isCarryover;
  const dateLabel   = new Date(entry.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  const iconBg    = isPositive ? c.semantic.positiveSoft : c.hair2;
  const iconColor = isPositive ? c.semantic.positive : c.textTertiary;
  const amountColor = isPositive ? c.semantic.positive
    : isCarryover ? c.semantic.negative : c.text;

  return (
    <BandRow last={last}>
      <View style={[styles.entryIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={meta.icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {entry.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
          {t(meta.labelKey)}
          {entry.sourceGroupName ? ` · ${entry.sourceGroupName}` : ''}
          {' · '}{dateLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={[Typography.amountS, { color: amountColor }]}>
          {isPositive ? '+' : '-'}{formatMoney(entry.amount, entry.currency)}
        </Text>
        {isReadOnly
          ? <Ionicons name="lock-closed-outline" size={12} color={c.textTertiary} />
          : (
            <Pressable onPress={onRemove} hitSlop={8}>
              <Ionicons name="trash-outline" size={14} color={c.textTertiary} />
            </Pressable>
          )}
      </View>
    </BandRow>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  debtsNote: { paddingHorizontal: Spacing.screenPad, marginTop: 6 },
  upper: { textTransform: 'uppercase' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: 14,
  },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: 16,
  },
  meterPad:  { paddingHorizontal: Spacing.screenPad, paddingTop: 15, paddingBottom: 16 },
  meterTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  meterEmpty:{ alignItems: 'center', gap: 10, paddingVertical: Spacing[6], paddingHorizontal: Spacing[6] },
  emptyBox:  { alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
  entryIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  budgetInput: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: Radius.md, borderWidth: 1, padding: 14,
  },
  toggle:      { width: 42, height: 25, borderRadius: 13, padding: 3 },
  toggleKnob:  { width: 19, height: 19, borderRadius: 10, backgroundColor: '#fff' },
  toggleKnobOn:{ transform: [{ translateX: 17 }] },
  saveBtn:     { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
});
