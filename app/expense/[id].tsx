import React, { useMemo } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { hapticLight, hapticWarning } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { MoneyText } from '@/src/components/MoneyText';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import { CommentThread } from '@/src/components/CommentThread';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { Avatar } from '@/src/components/Avatar';
import { hueForUser } from '@/src/utils/hueForUser';
import type { CategoryKind } from '@/src/constants/colors';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const expense = useExpenseStore(s => s.expenses.find(e => e.id === id));
  const updateExpense = useExpenseStore(s => s.updateExpense);
  const { getUserName } = useUserStore();
  const comments = useCommentStore(st => st.forExpense(id ?? ''));
  const addComment = useCommentStore(st => st.addComment);
  const removeComment = useCommentStore(st => st.removeComment);
  const removeCommentsForExpense = useCommentStore(st => st.removeForExpense);

  const dateStr = useMemo(() => {
    if (!expense) return '';
    return new Date(expense.date).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }, [expense]);

  if (!expense) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={styles.notFound}>
          <Text style={[Typography.bodyL, { color: c.textSecondary }]}>
            {t('expense.not_found')}
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={[Typography.bodyM, { color: c.brand.primary }]}>
              {t('common.go_back')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isCreator = expense.createdById === currentUser?.id;

  function handleAddComment(text: string) {
    if (!currentUser || !id) return;
    const now = Date.now();
    addComment({
      id:        uuidv4(),
      expenseId: id,
      authorId:  currentUser.id,
      text,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });
  }
  const hasPendingDelete = expense.deletionVotes.some(v => v.action === 'delete');

  function handleRequestDelete() {
    if (!currentUser || !expense) return;
    hapticWarning();
    Alert.alert(
      t('expense.delete_title'),
      isCreator ? t('expense.delete_body_creator') : t('expense.delete_body_member'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (isCreator) {
              // El creador borra directamente (tombstone). Los comentarios se
              // tombstonean en cascada: si no, quedan huérfanos apuntando a un
              // gasto inexistente y viajando en cada sync.
              updateExpense(expense.id, { isDeleted: true });
              removeCommentsForExpense(expense.id);
              router.back();
            } else {
              // Otros miembros votan por el borrado
              updateExpense(expense.id, {
                deletionVotes: [
                  ...expense.deletionVotes,
                  { userId: currentUser.id, votedAt: Date.now(), action: 'delete' },
                ],
              });
            }
          },
        },
      ],
    );
  }

  function handleCancelDeleteVote() {
    if (!currentUser || !expense) return;
    hapticLight();
    updateExpense(expense.id, {
      deletionVotes: expense.deletionVotes.filter(
        v => !(v.userId === currentUser.id && v.action === 'delete'),
      ),
    });
  }

  const myShare = expense.splits.find(s => s.userId === currentUser?.id)?.amount ?? 0;
  const isPayer = expense.paidById === currentUser?.id;
  const netForMe = isPayer ? expense.amount - myShare : -myShare;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.brand.primary} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]} numberOfLines={1}>
          {t('expense.detail_title')}
        </Text>
        {isCreator && !expense.isDeleted ? (
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push(`/expense/new?expenseId=${expense.id}` as any)}
              style={styles.iconBtn}
            >
              <Ionicons name="pencil-outline" size={20} color={c.brand.primary} />
            </Pressable>
            <Pressable onPress={handleRequestDelete} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={20} color={c.semantic.negative} />
            </Pressable>
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Hero */}
        <View style={styles.hero}>
          <CategoryIcon kind={expense.category as CategoryKind} size={64} />
          <Text style={[Typography.h1, { color: c.text, textAlign: 'center', marginTop: 12 }]}>
            {expense.description}
          </Text>
          <MoneyText minor={expense.amount} code={expense.currency} style={[Typography.amountL, { color: c.text, marginTop: 4 }]} />
          <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>
            {dateStr}
          </Text>
        </View>

        {/* Mi balance en este gasto */}
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 12 }]}>
            {t('expense.your_balance')}
          </Text>
          <View style={styles.balanceRow}>
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.paid_by')}
              </Text>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
                {isPayer ? t('common.you') : getUserName(expense.paidById)}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.your_share')}
              </Text>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
                {formatMoney(myShare, expense.currency)}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.net')}
              </Text>
              <Text style={[Typography.amountS, {
                color: netForMe >= 0 ? c.semantic.positive : c.semantic.negative,
                marginTop: 2,
              }]}>
                {netForMe >= 0 ? '+' : ''}{formatMoney(netForMe, expense.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Splits */}
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 12 }]}>
            {t('expense.split_detail')}
          </Text>
          {expense.splits.map((split, i) => {
            const name = split.userId === currentUser?.id
              ? t('common.you')
              : getUserName(split.userId);
            const isThisPayer = expense.paidById === split.userId;
            return (
              <View
                key={split.userId}
                style={[
                  styles.splitRow,
                  i < expense.splits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderHair },
                ]}
              >
                <Avatar name={name} hue={hueForUser(split.userId)} size={36} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                    {name}
                    {isThisPayer && (
                      <Text style={{ color: c.textTertiary, fontWeight: '400' }}>
                        {' '}· {t('expense.paid_label')}
                      </Text>
                    )}
                  </Text>
                </View>
                <Text style={[Typography.amountS, { color: c.text }]}>
                  {formatMoney(split.amount, expense.currency)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Nota */}
        {expense.note ? (
          <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
              {t('expense.note')}
            </Text>
            <Text style={[Typography.bodyM, { color: c.text }]}>{expense.note}</Text>
          </View>
        ) : null}

        {/* Solicitud de borrado pendiente */}
        {hasPendingDelete && (
          <View style={[styles.section, styles.warningSection, { backgroundColor: c.semantic.warningSoft, borderColor: c.semantic.warning }]}>
            <Ionicons name="warning-outline" size={18} color={c.semantic.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyM, { color: c.semantic.warning, fontWeight: '600' }]}>
                {t('expense.delete_pending_title')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.semantic.warning, marginTop: 2, opacity: 0.85 }]}>
                {t('expense.delete_pending_body')}
              </Text>
            </View>
          </View>
        )}

        {/* Botón de votar borrado (para no-creadores) */}
        {!isCreator && !expense.isDeleted && (
          <View style={[styles.section, { paddingHorizontal: Spacing.screenPad }]}>
            {hasPendingDelete ? (
              <Pressable
                onPress={handleCancelDeleteVote}
                style={[styles.actionBtn, { borderColor: c.borderHair, backgroundColor: c.surface }]}
              >
                <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
                  {t('expense.cancel_delete_vote')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleRequestDelete}
                style={[styles.actionBtn, { borderColor: c.semantic.negativeSoft, backgroundColor: c.semantic.negativeSoft }]}
              >
                <Ionicons name="trash-outline" size={16} color={c.semantic.negative} />
                <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
                  {t('expense.request_delete')}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Comentarios */}
        <View style={{ marginTop: Spacing[6] }}>
          <CommentThread
            comments={comments}
            currentUserId={currentUser?.id ?? ''}
            authorName={getUserName}
            onAdd={handleAddComment}
            onDelete={removeComment}
          />
        </View>

        <View style={{ height: Spacing[9] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1 },
  header:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn:    { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerRight:{ flexDirection: 'row', alignItems: 'center' },
  iconBtn:    { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll:   { paddingTop: Spacing[4] },
  hero:     { alignItems: 'center', paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[5] },
  section:  {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[4],
  },
  balanceRow:    { flexDirection: 'row', alignItems: 'center' },
  balanceCol:    { flex: 1, alignItems: 'center' },
  balanceDivider:{ width: StyleSheet.hairlineWidth, height: 32, backgroundColor: '#E0D9D0' },
  splitRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  warningSection:{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actionBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1,
  },
  notFound:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
