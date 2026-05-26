import React, { useMemo } from 'react';
import {
  Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupBalance } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { BalancePill } from '@/src/components/BalancePill';
import type { Expense } from '@/src/types/models';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const group       = useGroupStore(s => s.groups.find(g => g.id === id));
  const allExpenses = useExpenseStore(s => s.expenses);
  const { getUserName } = useUserStore();

  const expenses = useMemo(
    () => allExpenses
      .filter(e => e.groupId === id && !e.isDeleted)
      .sort((a, b) => b.date - a.date),
    [allExpenses, id],
  );

  const balances    = useGroupBalance(id ?? '', currentUser?.id ?? '');
  const mainBalance = balances.find(b => b.currency === group?.currency)?.amount ?? 0;

  if (!group) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[Typography.bodyM, { color: c.textTertiary }]}>Grupo no encontrado</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {group.name}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Balance card */}
        <View style={[styles.balanceCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
            Tu balance
          </Text>
          <View style={styles.balanceRow}>
            <BalancePill amount={mainBalance} currency={group.currency} size="lg" />
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
              {mainBalance > 0 ? 'te deben' : mainBalance < 0 ? 'debés' : 'estás al día'}
            </Text>
          </View>
        </View>

        {/* Members row */}
        <View style={styles.membersRow}>
          {group.memberIds.map(uid => (
            <View key={uid} style={{ alignItems: 'center', gap: 4 }}>
              <Avatar name={getUserName(uid)} hue={hueForUser(uid)} size={36} />
              <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
                {getUserName(uid).split(' ')[0]}
              </Text>
            </View>
          ))}
        </View>

        {/* Expenses */}
        <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
          GASTOS ({expenses.length})
        </Text>

        {expenses.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="receipt-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8 }]}>
              Sin gastos aún
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.cardGap }}>
            {expenses.map(e => (
              <ExpenseRow
                key={e.id}
                expense={e}
                currentUserId={currentUser?.id ?? ''}
                getUserName={getUserName}
              />
            ))}
          </View>
        )}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => router.push({
          pathname: '/expense/new',
          params: { groupId: id },
        } as any)}
        style={[styles.fab, { backgroundColor: c.brand.primary }]}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
          Agregar gasto
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

function ExpenseRow({
  expense, currentUserId, getUserName,
}: {
  expense: Expense;
  currentUserId: string;
  getUserName: (id: string) => string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const myShare   = expense.splits.find(s => s.userId === currentUserId);
  const isPayer   = expense.paidById === currentUserId;
  const dateLabel = new Date(expense.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

  const netForMe = isPayer
    ? expense.amount - (myShare?.amount ?? 0)
    : -(myShare?.amount ?? 0);

  return (
    <Pressable style={[styles.expenseRow, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <View style={[styles.expenseIcon, { backgroundColor: c.surfaceSunken }]}>
        <Ionicons name="receipt-outline" size={18} color={c.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {expense.description}
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
          {getUserName(expense.paidById)} · {dateLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[Typography.amountS, {
          color: netForMe > 0 ? c.semantic.positive : netForMe < 0 ? c.semantic.negative : c.textTertiary,
        }]}>
          {netForMe > 0 ? '+' : ''}{formatMoney(netForMe, expense.currency)}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {formatMoney(expense.amount, expense.currency)} total
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  scroll:       { paddingTop: Spacing[4] },
  balanceCard:  {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1, gap: 8,
  },
  balanceRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  membersRow:   {
    flexDirection: 'row', flexWrap: 'wrap', gap: 14,
    paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
  },
  sectionLabel: {
    paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[2],
  },
  emptyBox:     {
    marginHorizontal: Spacing.screenPad,
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing[6], borderRadius: Radius.lg, borderWidth: 1,
  },
  expenseRow:   {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: Spacing.screenPad,
    padding: Spacing.cardPad, borderRadius: Radius.lg, borderWidth: 1,
  },
  expenseIcon:  {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  fab:          {
    position: 'absolute', right: 20, bottom: 24,
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    shadowColor: '#0A6E8F', shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
