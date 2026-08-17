import React, { useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { hapticLight, hapticSuccess } from '@/src/utils/haptics';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupBalance } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { BalancePill } from '@/src/components/BalancePill';
import type { Expense, Payment } from '@/src/types/models';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';

type TimelineItem =
  | { type: 'expense'; data: Expense; ts: number }
  | { type: 'payment'; data: Payment; ts: number };

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const deleteGroup = useGroupStore(st => st.deleteGroup);
  const leaveGroup  = useGroupStore(st => st.leaveGroup);
  const group        = useGroupStore(s => s.groups.find(g => g.id === id));
  const updateGroup  = useGroupStore(s => s.updateGroup);
  const allExpenses  = useExpenseStore(s => s.expenses);
  const allPayments  = usePaymentStore(s => s.payments);
  const { getUserName, addOrUpdateUser } = useUserStore();

  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const e of allExpenses) {
      if (e.groupId === id && !e.isDeleted) items.push({ type: 'expense', data: e, ts: e.date });
    }
    for (const p of allPayments) {
      if (p.groupId === id && !p.isDeleted) items.push({ type: 'payment', data: p, ts: p.date });
    }
    return items.sort((a, b) => b.ts - a.ts);
  }, [allExpenses, allPayments, id]);

  const balances    = useGroupBalance(id ?? '', currentUser?.id ?? '');
  const mainBalance = balances.find(b => b.currency === group?.currency)?.amount ?? 0;

  function handleAddMember() {
    const name = inviteName.trim();
    if (!name || !group) return;

    const newUser = {
      id:           uuidv4(),
      name,
      email:        '',
      authProvider: 'google' as const,
      updatedAt:    Date.now(),
      isDeleted:    false,
      createdAt:    Date.now(),
    };

    addOrUpdateUser(newUser);
    updateGroup(group.id, { memberIds: [...group.memberIds, newUser.id] });
    hapticSuccess();
    setInviteName('');
    setInviteVisible(false);
    Alert.alert(
      t('group_detail.member_added_title'),
      t('group_detail.member_added_body', { name }),
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('group_detail.not_found')}</Text>
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
            {t('group_detail.balance_label')}
          </Text>
          <View style={styles.balanceRow}>
            <BalancePill amount={mainBalance} currency={group.currency} size="lg" />
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
              {mainBalance > 0 ? t('group_detail.owe_you') : mainBalance < 0 ? t('group_detail.you_owe_short') : t('group_detail.settled_up')}
            </Text>
          </View>
        </View>

        {/* Members */}
        <View style={styles.membersSection}>
          <View style={styles.membersHeader}>
            <Text style={[Typography.label, { color: c.textTertiary }]}>
              {t('group_detail.members_label', { count: group.memberIds.length })}
            </Text>
            <Pressable
              onPress={() => setInviteVisible(true)}
              style={[styles.addMemberBtn, { backgroundColor: c.brand.primarySoft }]}
            >
              <Ionicons name="person-add-outline" size={14} color={c.brand.primary} />
              <Text style={[Typography.caption, { color: c.brand.primary, fontWeight: '600' }]}>
                {t('common.add')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.membersRow}>
            {group.memberIds.map(uid => (
              <View key={uid} style={{ alignItems: 'center', gap: 4 }}>
                <Avatar name={getUserName(uid)} hue={hueForUser(uid)} size={40} />
                <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
                  {getUserName(uid).split(' ')[0]}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Timeline: expenses + payments */}
        <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
          {t('group_detail.activity_label', { count: timeline.length })}
        </Text>

        {timeline.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="receipt-outline" size={28} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8 }]}>
              {t('group_detail.no_activity')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.cardGap }}>
            {timeline.map(item =>
              item.type === 'expense' ? (
                <ExpenseRow
                  key={item.data.id}
                  expense={item.data}
                  currentUserId={currentUser?.id ?? ''}
                  getUserName={getUserName}
                />
              ) : (
                <PaymentRow
                  key={item.data.id}
                  payment={item.data}
                  currentUserId={currentUser?.id ?? ''}
                  getUserName={getUserName}
                />
              ),
            )}
          </View>
        )}

        {/* Salir / eliminar */}
        {group && currentUser && (
          <View style={styles.dangerZone}>
            {group.createdById === currentUser.id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Alert.alert(
                    t('group_detail.delete_title'),
                    t('group_detail.delete_body', { name: group.name }),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('common.delete'),
                        style: 'destructive',
                        onPress: () => { deleteGroup(group.id); router.back(); },
                      },
                    ],
                  );
                }}
                style={styles.dangerRow}
              >
                <Ionicons name="trash-outline" size={16} color={c.semantic.negative} />
                <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
                  {t('group_detail.delete_group')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Alert.alert(
                    t('group_detail.leave_title'),
                    t('group_detail.leave_body'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('group_detail.leave_confirm'),
                        style: 'destructive',
                        onPress: () => { leaveGroup(group.id, currentUser.id); router.back(); },
                      },
                    ],
                  );
                }}
                style={styles.dangerRow}
              >
                <Ionicons name="exit-outline" size={16} color={c.semantic.negative} />
                <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
                  {t('group_detail.leave_group')}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => { hapticLight(); router.push({ pathname: '/expense/new', params: { groupId: id } } as any); }}
        style={[styles.fab, { backgroundColor: c.brand.primary }]}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t('group_detail.add_expense')}</Text>
      </Pressable>

      {/* Modal — Invitar miembro */}
      <Modal
        visible={inviteVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteVisible(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setInviteVisible(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.sheet, { backgroundColor: c.surface }]}>
              <View style={[styles.handle, { backgroundColor: c.borderHair }]} />

              <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>
                {t('group_detail.add_member_title')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
                {t('group_detail.add_member_body')}
              </Text>

              <TextInput
                value={inviteName}
                onChangeText={setInviteName}
                placeholder={t('group_detail.name_placeholder')}
                placeholderTextColor={c.textTertiary}
                style={[styles.input, { backgroundColor: c.surfaceSunken, color: c.text, borderColor: c.border }]}
                returnKeyType="done"
                onSubmitEditing={handleAddMember}
              />

              <Pressable
                onPress={handleAddMember}
                style={[styles.confirmBtn, { backgroundColor: inviteName.trim() ? c.brand.primary : c.surfaceSunken }]}
              >
                <Text style={[Typography.bodyM, { color: inviteName.trim() ? '#fff' : c.textTertiary, fontWeight: '600' }]}>
                  {t('group_detail.add_to_group')}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  const { t } = useTranslation();
  const c = Colors[scheme];

  const myShare   = expense.splits.find(s => s.userId === currentUserId);
  const isPayer   = expense.paidById === currentUserId;
  const dateLabel = new Date(expense.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const netForMe  = isPayer
    ? expense.amount - (myShare?.amount ?? 0)
    : -(myShare?.amount ?? 0);

  return (
    <Pressable
      onPress={() => router.push(`/expense/${expense.id}` as any)}
      style={({ pressed }) => [
        styles.expenseRow,
        { backgroundColor: c.surface, borderColor: c.borderHair, opacity: pressed ? 0.85 : 1 },
      ]}
    >
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
          {t('group_detail.total_suffix', { amount: formatMoney(expense.amount, expense.currency) })}
        </Text>
      </View>
    </Pressable>
  );
}

function PaymentRow({
  payment, currentUserId, getUserName,
}: {
  payment: Payment;
  currentUserId: string;
  getUserName: (id: string) => string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const fromName  = payment.fromUserId === currentUserId ? t('common.you') : getUserName(payment.fromUserId);
  const toName    = payment.toUserId   === currentUserId ? t('common.you') : getUserName(payment.toUserId);
  const dateLabel = new Date(payment.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  return (
    <View style={[styles.expenseRow, { backgroundColor: c.semantic.positiveSoft, borderColor: c.semantic.positive + '33' }]}>
      <View style={[styles.expenseIcon, { backgroundColor: c.semantic.positive + '22' }]}>
        <Ionicons name="checkmark-circle-outline" size={18} color={c.semantic.positive} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {t('group_detail.paid_to', { from: fromName, to: toName })}
        </Text>
        <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
          {t('group_detail.payment_label')} · {dateLabel}
        </Text>
      </View>
      <Text style={[Typography.amountS, { color: c.semantic.positive }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dangerZone: { marginTop: 32, alignItems: 'center' },
  dangerRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  safe:           { flex: 1 },
  header:         {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  scroll:         { paddingTop: Spacing[4] },
  balanceCard:    {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1, gap: 8,
  },
  balanceRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  membersSection: { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  membersHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addMemberBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  membersRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  sectionLabel:   { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[2] },
  emptyBox:       {
    marginHorizontal: Spacing.screenPad,
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing[6], borderRadius: Radius.lg, borderWidth: 1,
  },
  expenseRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: Spacing.screenPad,
    padding: Spacing.cardPad, borderRadius: Radius.lg, borderWidth: 1,
  },
  expenseIcon:    { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  fab:            {
    position: 'absolute', right: 20, bottom: 24,
    height: 56, paddingHorizontal: 20,
    borderRadius: Radius.full,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    boxShadow: '0 8px 24px rgba(10,110,143,0.35)',
  },
  // Modal
  modalRoot:   { flex: 1, justifyContent: 'flex-end' },
  sheet:       { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:      { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  input:       {
    height: 50, borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 16, marginBottom: 14,
  },
  confirmBtn:  { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
