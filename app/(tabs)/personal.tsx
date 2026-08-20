import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
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
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore, toMonthKey, currentMonthKey } from '@/src/store/personalStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hapticLight, hapticSelection, hapticWarning } from '@/src/utils/haptics';
import { v4 as uuidv4 } from 'uuid';
import { BottomSheet } from '@/src/components/Sheet';
import type { PersonalBudget, PersonalEntry } from '@/src/types/models';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
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
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { entries, budget, removeEntry, setBudget, addEntry, lastSeenMonth, setLastSeenMonth } = usePersonalStore();
  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');

  const today = toMonthKey(Date.now());
  const [activeMonth, setActiveMonth] = useState(today);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [includeOwedToMe, setIncludeOwedToMe] = useState(budget.includeOwedToMe);
  const [budgetCurrency, setBudgetCurrency] = useState<CurrencyCode>(budget.currency);
  const {
    text: budgetInput,
    minor: budgetAmount,
    onChangeText: setBudgetInput,
    onBlur: onBudgetInputBlur,
  } = useAmountInput(budgetCurrency, budget.monthlyAmount);

  const cur = budget.currency as CurrencyCode;

  // Money owed to me and by me across all groups in budget currency
  const owedToMe = useMemo(
    () => personBalances
      .filter(b => b.currency === cur && b.amount > 0)
      .reduce((s, b) => s + b.amount, 0),
    [personBalances, cur],
  );
  const youOwe = useMemo(
    () => Math.abs(
      personBalances
        .filter(b => b.currency === cur && b.amount < 0)
        .reduce((s, b) => s + b.amount, 0),
    ),
    [personBalances, cur],
  );

  // Keep an up-to-date ref for owedToMe so the carryover effect can read it without re-triggering
  const owedToMeRef = useRef(owedToMe);
  useEffect(() => { owedToMeRef.current = owedToMe; }, [owedToMe]);

  // Month-rollover: when a new month is detected, create a carryover entry from the prev month's balance
  useEffect(() => {
    const thisMonth = currentMonthKey();
    if (!lastSeenMonth || lastSeenMonth >= thisMonth) return;

    const { entries: allEntries, budget: curBudget, addEntry: add, setLastSeenMonth: setSeen } =
      usePersonalStore.getState();
    const c = curBudget.currency;

    // Guard: don't create duplicate carryovers
    const alreadyCarried = allEntries.some(
      e => !e.isDeleted && e.kind === 'carryover' && toMonthKey(e.date) === thisMonth,
    );
    if (alreadyCarried) { setSeen(thisMonth); return; }

    const prevEntries = allEntries.filter(
      e => !e.isDeleted && e.currency === c && toMonthKey(e.date) === lastSeenMonth,
    );

    const prevIncome      = prevEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
    const prevExpense     = prevEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
    const prevGroup       = prevEntries.filter(e => e.kind === 'group_replicated').reduce((s, e) => s + e.amount, 0);
    const prevPosCarry    = prevEntries.filter(e => e.kind === 'carryover' && e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);
    const prevNegCarry    = prevEntries.filter(e => e.kind === 'carryover' && !e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);

    const prevEffective = curBudget.monthlyAmount + prevIncome + prevPosCarry +
      (curBudget.includeOwedToMe ? owedToMeRef.current : 0);
    const prevSpent     = prevExpense + prevGroup + prevNegCarry;
    const prevRemaining = prevEffective - prevSpent;

    if (Math.abs(prevRemaining) >= 0.01) {
      const firstOfMonth = new Date(`${thisMonth}-01T12:00:00`).getTime();
      add({
        id:                 uuidv4(),
        kind:               'carryover',
        isPositiveCarryover: prevRemaining > 0,
        description:        `Saldo de ${monthLabel(lastSeenMonth)}`,
        amount:             Math.abs(prevRemaining),
        currency:           c,
        category:           'other',
        date:               firstOfMonth,
        createdAt:          Date.now(),
        updatedAt:          syncedNow(),
        isDeleted:          false,
      });
    }

    setSeen(thisMonth);
  }, [lastSeenMonth]); // Only runs when lastSeenMonth changes (once per month)

  // Entries for this month, not deleted, in budget currency
  const monthEntries = useMemo(
    () => entries.filter(e => !e.isDeleted && e.currency === cur && toMonthKey(e.date) === activeMonth),
    [entries, cur, activeMonth],
  );

  const totalIncome      = monthEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense     = monthEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const totalGroup       = monthEntries.filter(e => e.kind === 'group_replicated').reduce((s, e) => s + e.amount, 0);
  const positiveCarryover = monthEntries.filter(e => e.kind === 'carryover' && e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);
  const negativeCarryover = monthEntries.filter(e => e.kind === 'carryover' && !e.isPositiveCarryover).reduce((s, e) => s + e.amount, 0);
  const totalSpent       = totalExpense + totalGroup + negativeCarryover;

  const baseBudget      = budget.monthlyAmount;
  const effectiveBudget = baseBudget + totalIncome + positiveCarryover + (budget.includeOwedToMe ? owedToMe : 0);
  const remaining       = effectiveBudget - totalSpent;
  const pct             = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget       = baseBudget > 0;

  const barColor = pct >= 1 ? c.semantic.negative
    : pct >= 0.8 ? c.semantic.warning
    : c.semantic.positive;

  function handleSaveBudget() {
    setBudget({ currency: budgetCurrency, monthlyAmount: budgetAmount, includeOwedToMe });
    hapticLight();
    setShowBudgetSheet(false);
  }

  function handleRemove(entry: PersonalEntry) {
    if (entry.kind === 'group_replicated') return;
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
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[Typography.display, { color: c.text }]}>{t('personal.title')}</Text>
          <Pressable
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}
          >
            <Ionicons name="settings-outline" size={18} color={c.text} />
          </Pressable>
        </View>

        {/* Month navigator */}
        <View style={styles.monthNav}>
          <Pressable onPress={() => { hapticSelection(); setActiveMonth(prevMonth(activeMonth)); }} hitSlop={12}>
            <Ionicons name="chevron-back" size={20} color={c.textSecondary} />
          </Pressable>
          <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]}>
            {monthLabel(activeMonth)}
          </Text>
          <Pressable
            onPress={() => { hapticSelection(); setActiveMonth(nextMonth(activeMonth)); }}
            disabled={activeMonth >= today}
            hitSlop={12}
          >
            <Ionicons name="chevron-forward" size={20} color={activeMonth >= today ? c.textDisabled : c.textSecondary} />
          </Pressable>
        </View>

        {/* Budget meter */}
        {hasBudget ? (
          <View style={[styles.meterCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <View style={styles.meterTop}>
              <View>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {t('personal.spent')}
                </Text>
                <MoneyText minor={totalSpent} code={cur} style={[Typography.amountM, { color: c.text }]} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {remaining >= 0 ? t('personal.available') : t('personal.exceeded')}
                </Text>
                <MoneyText minor={Math.abs(remaining)} code={cur} style={[Typography.amountM, { color: remaining >= 0 ? barColor : c.semantic.negative }]} />
              </View>
            </View>
            {/* Progress bar */}
            <View style={[styles.barTrack, { backgroundColor: c.surfaceSunken }]}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center' }]}>
              {t('personal.budget_progress', { pct: Math.round(pct * 100), amount: formatMoney(effectiveBudget, cur) })}
              {budget.includeOwedToMe && owedToMe > 0 ? t('personal.budget_includes_owed', { amount: formatMoney(owedToMe, cur) }) : ''}
            </Text>
            {youOwe > 0 && (
              <View style={[styles.debtBadge, { backgroundColor: c.semantic.negativeSoft }]}>
                <Ionicons name="warning-outline" size={12} color={c.semantic.negative} />
                <Text style={[Typography.caption, { color: c.semantic.negative }]}>
                  {t('personal.debt_note', { amount: formatMoney(youOwe, cur) })}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Pressable
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.meterCard, styles.meterEmpty, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <Ionicons name="bar-chart-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
              {t('personal.budget_empty')}
            </Text>
            <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
              {t('personal.budget_configure')}
            </Text>
          </Pressable>
        )}

        {/* Summary chips */}
        <View style={styles.summaryRow}>
          <SummaryChip label={t('personal.summary_income')} amount={totalIncome} currency={cur} positive scheme={scheme} />
          <SummaryChip label={t('personal.summary_personal')} amount={totalExpense} currency={cur} scheme={scheme} />
          <SummaryChip label={t('personal.summary_groups')} amount={totalGroup} currency={cur} scheme={scheme} />
          {youOwe > 0 && (
            <SummaryChip label={t('personal.summary_owe')} amount={youOwe} currency={cur} negative scheme={scheme} />
          )}
        </View>

        {/* Entries list */}
        <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
          {t('personal.movements_count', { count: monthEntries.length })}
        </Text>

        {monthEntries.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="receipt-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8, textAlign: 'center' }]}>
              {t('personal.no_movements', { month: monthLabel(activeMonth) })}
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.cardGap, paddingHorizontal: Spacing.screenPad }}>
            {[...monthEntries].sort((a, b) => b.date - a.date).map(entry => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onRemove={() => handleRemove(entry)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* FAB — dos acciones */}
      <FabRow>
        <Fab
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense/new', params: { allowIncome: '1', kind: 'income' } } as any)}
          icon="trending-up-outline"
          label={t('personal.fab_income')}
          backgroundColor={c.semantic.positiveSoft}
          borderColor={c.semantic.positive + '44'}
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

      {/* Budget settings sheet */}
      <BottomSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>{t('personal.budget_sheet_title')}</Text>
        <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
          {t('personal.budget_reset_note')}
        </Text>

        <Text style={[Typography.label, { color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase' }]}>
          {t('personal.amount')}
        </Text>
        <View style={[styles.budgetInput, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
          <Text style={[Typography.bodyL, { color: c.textTertiary }]}>$</Text>
          <TextInput
            value={budgetInput}
            onChangeText={setBudgetInput}
            onBlur={onBudgetInputBlur}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={c.textTertiary}
            style={[Typography.bodyL, { flex: 1, color: c.text, padding: 0 }]}
            returnKeyType="done"
          />
        </View>

        {/* Include owed-to-me toggle */}
        <Pressable
          onPress={() => { hapticSelection(); setIncludeOwedToMe(v => !v); }}
          style={[styles.toggleRow, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
              {t('personal.include_owed')}
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              {t('personal.include_owed_sub')}
            </Text>
          </View>
          <View style={[
            styles.toggle,
            { backgroundColor: includeOwedToMe ? c.brand.primary : c.border },
          ]}>
            <View style={[styles.toggleKnob, includeOwedToMe && styles.toggleKnobOn]} />
          </View>
        </Pressable>

        <Pressable
          onPress={handleSaveBudget}
          style={[styles.saveBtn, { backgroundColor: c.brand.primary, marginTop: 16 }]}
        >
          <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>{t('personal.save_budget')}</Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
}

function SummaryChip({
  label, amount, currency, positive, negative, scheme,
}: {
  label: string; amount: number; currency: CurrencyCode;
  positive?: boolean; negative?: boolean; scheme: 'light' | 'dark';
}) {
  const c = Colors[scheme];
  const textColor = positive ? c.semantic.positive : negative ? c.semantic.negative : c.text;
  return (
    <View style={[summaryStyles.chip, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <Text style={[Typography.caption, { color: c.textTertiary }]}>{label}</Text>
      <Text style={[Typography.bodyS, { color: textColor, fontWeight: '700' }]}>
        {positive ? '+' : negative ? '-' : ''}{formatMoney(amount, currency)}
      </Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  chip: { flex: 1, alignItems: 'center', gap: 3, padding: 10, borderRadius: Radius.md, borderWidth: 1 },
});

function EntryRow({ entry, onRemove }: { entry: PersonalEntry; onRemove: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];
  const meta = ENTRY_KIND_META[entry.kind];
  const isCarryover = entry.kind === 'carryover';
  const isPositive  = entry.kind === 'income' || (isCarryover && entry.isPositiveCarryover === true);
  const isReadOnly  = entry.kind === 'group_replicated' || isCarryover;
  const dateLabel   = new Date(entry.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  const iconBg    = isPositive ? c.semantic.positiveSoft
    : isReadOnly ? c.surfaceSunken : c.semantic.negativeSoft;
  const iconColor = isPositive ? c.semantic.positive
    : isReadOnly ? c.textTertiary : c.semantic.negative;
  const amountColor = isPositive ? c.semantic.positive
    : isCarryover ? c.semantic.negative : c.text;

  return (
    <View style={[
      entryStyles.row,
      { backgroundColor: c.surface, borderColor: c.borderHair },
      isPositive && { borderColor: c.semantic.positive + '44' },
    ]}>
      <View style={[entryStyles.iconBox, { backgroundColor: iconBg }]}>
        <Ionicons name={meta.icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {entry.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {t(meta.labelKey)}
          {entry.sourceGroupName ? ` · ${entry.sourceGroupName}` : ''}
          {' · '}{dateLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[Typography.amountS, { color: amountColor }]}>
          {isPositive ? '+' : '-'}{formatMoney(entry.amount, entry.currency)}
        </Text>
        {!isReadOnly && (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Ionicons name="trash-outline" size={14} color={c.textTertiary} />
          </Pressable>
        )}
        {isReadOnly && (
          <Ionicons name="lock-closed-outline" size={12} color={c.textTertiary} />
        )}
      </View>
    </View>
  );
}

const entryStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: Spacing.cardPad, borderRadius: Radius.lg, borderWidth: 1,
  },
  iconBox: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  scroll:      { paddingTop: Spacing[2] },
  header:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  monthNav:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
  },
  meterCard:   {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[4], gap: 12,
  },
  meterEmpty:  { alignItems: 'center', gap: 10 },
  meterTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  barTrack:    { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill:     { height: 10, borderRadius: 5 },
  debtBadge:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  summaryRow:  { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  sectionLabel:{ paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[2] },
  emptyBox:    {
    marginHorizontal: Spacing.screenPad,
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing[6], borderRadius: Radius.lg, borderWidth: 1,
  },
  budgetInput: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
  },
  toggleRow:   {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: Radius.lg, borderWidth: 1, padding: 14,
  },
  toggle:      { width: 44, height: 26, borderRadius: 13, padding: 3 },
  toggleKnob:  { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleKnobOn:{ transform: [{ translateX: 18 }] },
  saveBtn:     { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
});
