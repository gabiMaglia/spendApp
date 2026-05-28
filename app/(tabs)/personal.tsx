import React, { useMemo, useState } from 'react';
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
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hapticLight, hapticSelection, hapticWarning } from '@/src/utils/haptics';
import { BottomSheet } from '@/src/components/Sheet';
import type { PersonalBudget, PersonalEntry } from '@/src/types/models';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
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
  expense:         { icon: 'trending-down-outline' as const, label: 'Gasto personal' },
  income:          { icon: 'trending-up-outline'   as const, label: 'Ingreso' },
  group_replicated:{ icon: 'people-outline'        as const, label: 'Del grupo' },
};

export default function PersonalScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { entries, budget, removeEntry, setBudget } = usePersonalStore();
  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');

  const today = toMonthKey(Date.now());
  const [activeMonth, setActiveMonth] = useState(today);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(budget.monthlyAmount || ''));
  const [includeOwedToMe, setIncludeOwedToMe] = useState(budget.includeOwedToMe);
  const [budgetCurrency, setBudgetCurrency] = useState<CurrencyCode>(budget.currency);

  const cur = budget.currency as CurrencyCode;

  // Entries for this month, not deleted, in budget currency
  const monthEntries = useMemo(
    () => entries.filter(e => !e.isDeleted && e.currency === cur && toMonthKey(e.date) === activeMonth),
    [entries, cur, activeMonth],
  );

  const totalIncome   = monthEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense  = monthEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const totalGroup    = monthEntries.filter(e => e.kind === 'group_replicated').reduce((s, e) => s + e.amount, 0);
  const totalSpent    = totalExpense + totalGroup;

  // Money owed to me across all groups (positive balances in budget currency)
  const owedToMe = useMemo(
    () => personBalances
      .filter(b => b.currency === cur && b.amount > 0)
      .reduce((s, b) => s + b.amount, 0),
    [personBalances, cur],
  );

  const baseBudget     = budget.monthlyAmount;
  const effectiveBudget = baseBudget + totalIncome + (budget.includeOwedToMe ? owedToMe : 0);
  const remaining      = effectiveBudget - totalSpent;
  const pct            = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget      = baseBudget > 0;

  const barColor = pct >= 1 ? c.semantic.negative
    : pct >= 0.8 ? c.semantic.warning
    : c.semantic.positive;

  function handleSaveBudget() {
    const amount = parseFloat(budgetInput.replace(',', '.')) || 0;
    setBudget({ currency: budgetCurrency, monthlyAmount: amount, includeOwedToMe });
    hapticLight();
    setShowBudgetSheet(false);
  }

  function handleRemove(entry: PersonalEntry) {
    if (entry.kind === 'group_replicated') return;
    hapticWarning();
    Alert.alert(
      'Eliminar entrada',
      `¿Eliminar "${entry.description}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => removeEntry(entry.id) },
      ],
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[Typography.display, { color: c.text }]}>Personal</Text>
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
                  Gastado
                </Text>
                <Text style={[Typography.amountM, { color: c.text }]}>
                  {formatMoney(totalSpent, cur)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {remaining >= 0 ? 'Disponible' : 'Excedido'}
                </Text>
                <Text style={[Typography.amountM, { color: remaining >= 0 ? barColor : c.semantic.negative }]}>
                  {formatMoney(Math.abs(remaining), cur)}
                </Text>
              </View>
            </View>
            {/* Progress bar */}
            <View style={[styles.barTrack, { backgroundColor: c.surfaceSunken }]}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center' }]}>
              {Math.round(pct * 100)}% de {formatMoney(effectiveBudget, cur)}
              {budget.includeOwedToMe && owedToMe > 0 ? ` (incluye ${formatMoney(owedToMe, cur)} que te deben)` : ''}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.meterCard, styles.meterEmpty, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <Ionicons name="bar-chart-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
              Configurá un presupuesto mensual para ver tu progreso
            </Text>
            <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
              Configurar presupuesto →
            </Text>
          </Pressable>
        )}

        {/* Summary chips */}
        <View style={styles.summaryRow}>
          <SummaryChip label="Ingresos"   amount={totalIncome}  currency={cur} positive scheme={scheme} />
          <SummaryChip label="Gastos prop" amount={totalExpense} currency={cur} scheme={scheme} />
          <SummaryChip label="Del grupo"  amount={totalGroup}   currency={cur} scheme={scheme} />
        </View>

        {/* Entries list */}
        <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
          MOVIMIENTOS ({monthEntries.length})
        </Text>

        {monthEntries.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="receipt-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8, textAlign: 'center' }]}>
              Sin movimientos en {monthLabel(activeMonth)}
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.cardGap }}>
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
      <View style={styles.fabGroup}>
        <Pressable
          onPress={() => { hapticLight(); router.push({ pathname: '/personal/new', params: { kind: 'income' } } as any); }}
          style={[styles.fabSecondary, { backgroundColor: c.semantic.positiveSoft, borderColor: c.semantic.positive + '44' }]}
        >
          <Ionicons name="trending-up-outline" size={20} color={c.semantic.positive} />
          <Text style={[Typography.bodyS, { color: c.semantic.positive, fontWeight: '700' }]}>Ingreso</Text>
        </Pressable>
        <Pressable
          onPress={() => { hapticLight(); router.push('/personal/new' as any); }}
          style={[styles.fab, { backgroundColor: c.brand.primary }]}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>Gasto</Text>
        </Pressable>
      </View>

      {/* Budget settings sheet */}
      <BottomSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>Presupuesto mensual</Text>
        <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
          Se resetea el 1º de cada mes.
        </Text>

        <Text style={[Typography.label, { color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase' }]}>
          Monto
        </Text>
        <View style={[styles.budgetInput, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
          <Text style={[Typography.bodyL, { color: c.textTertiary }]}>$</Text>
          <TextInput
            value={budgetInput}
            onChangeText={setBudgetInput}
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
              Incluir lo que me deben
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              El dinero pendiente de tus grupos suma al presupuesto
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
          <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>Guardar presupuesto</Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
}

function SummaryChip({
  label, amount, currency, positive, scheme,
}: {
  label: string; amount: number; currency: CurrencyCode;
  positive?: boolean; scheme: 'light' | 'dark';
}) {
  const c = Colors[scheme];
  return (
    <View style={[summaryStyles.chip, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <Text style={[Typography.caption, { color: c.textTertiary }]}>{label}</Text>
      <Text style={[Typography.bodyS, {
        color: positive ? c.semantic.positive : c.text,
        fontWeight: '700',
      }]}>
        {positive ? '+' : ''}{formatMoney(amount, currency)}
      </Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  chip: { flex: 1, alignItems: 'center', gap: 3, padding: 10, borderRadius: Radius.md, borderWidth: 1 },
});

function EntryRow({ entry, onRemove }: { entry: PersonalEntry; onRemove: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const meta = ENTRY_KIND_META[entry.kind];
  const isIncome = entry.kind === 'income';
  const isReadOnly = entry.kind === 'group_replicated';
  const dateLabel = new Date(entry.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

  return (
    <View style={[
      entryStyles.row,
      { backgroundColor: c.surface, borderColor: c.borderHair },
      isIncome && { borderColor: c.semantic.positive + '44' },
    ]}>
      <View style={[entryStyles.iconBox, {
        backgroundColor: isIncome ? c.semantic.positiveSoft : isReadOnly ? c.surfaceSunken : c.semantic.negativeSoft,
      }]}>
        <Ionicons
          name={meta.icon}
          size={18}
          color={isIncome ? c.semantic.positive : isReadOnly ? c.textTertiary : c.semantic.negative}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {entry.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {meta.label}
          {entry.sourceGroupName ? ` · ${entry.sourceGroupName}` : ''}
          {' · '}{dateLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[Typography.amountS, {
          color: isIncome ? c.semantic.positive : c.text,
        }]}>
          {isIncome ? '+' : '-'}{formatMoney(entry.amount, entry.currency)}
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
  summaryRow:  { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  sectionLabel:{ paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[2] },
  emptyBox:    {
    marginHorizontal: Spacing.screenPad,
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing[6], borderRadius: Radius.lg, borderWidth: 1,
  },
  fabGroup:    {
    position: 'absolute', right: 20, bottom: 90,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  fab:         {
    height: 52, paddingHorizontal: 18,
    borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', gap: 6,
    boxShadow: '0 8px 24px rgba(10,110,143,0.35)',
  },
  fabSecondary:{
    height: 44, paddingHorizontal: 14, borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
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
