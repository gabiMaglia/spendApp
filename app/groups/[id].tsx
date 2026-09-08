import React, { useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
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
import { UserAvatar } from '@/src/components/UserAvatar';
import { SyncWarningBanner } from '@/src/components/SyncWarningBanner';
import { useGroupSyncFailure, claveDeFalloDeSync } from '@/src/sync/useSyncFailure';
import { createInvite, inviteToLink } from '@/src/sync/groupInvite';
import { ensureIdentity, saveInvite } from '@/src/store/identityStore';
import { startRelay, announceGroupToContacts } from '@/src/sync/relayEngine';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { Fab, FabRow } from '@/src/components/Fab';
import { TrustMark } from '@/src/components/TrustMark';
import { SettlementAcuse } from '@/src/components/SettlementAcuse';
import { yaAprobo } from '@/src/algorithms/leaveRequest';
import { verifyLeaveApproval } from '@/src/sync/leaveApprovalSign';
import { authorKeysFor } from '@/src/sync/authorKeys';
import { useSaldadoAcuse } from '@/src/hooks/useSaldadoAcuse';
import { useRecordTrust } from '@/src/hooks/useRecordTrust';
import { isMarked, type TrustState } from '@/src/algorithms/recordTrust';
import { canLeaveGroup } from '@/src/algorithms/canLeaveGroup';
import { approvalProgress } from '@/src/algorithms/leaveRequest';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { Band, BandRow, SectionLabel } from '@/src/components/Band';
import { DetailHeader } from '@/src/components/CollapsibleHeader';
import type { Expense, Payment } from '@/src/types/models';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo, mismaPersona } from '@/src/store/identityAlias';

type TimelineItem =
  | { type: 'expense'; data: Expense; ts: number }
  | { type: 'payment'; data: Payment; ts: number };

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const falloDeSync = useGroupSyncFailure(id as string);
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const ensureKey    = useGroupKeyStore(st => st.ensureKey);
  const approveLeave = useGroupStore(st => st.approveLeave);
  const cancelLeave  = useGroupStore(st => st.cancelLeave);
  const deleteGroup  = useGroupStore(st => st.deleteGroup);
  const leaveGroup   = useGroupStore(st => st.leaveGroup);
  const group        = useGroupStore(s => s.groups.find(g => g.id === id));
  const updateGroup  = useGroupStore(s => s.updateGroup);
  const allExpenses  = useExpenseStore(s => s.expenses);

  const tieneGastos = useMemo(
    () => allExpenses.some(e => e.groupId === id && !e.isDeleted),
    [allExpenses, id],
  );
  const allPayments = usePaymentStore(s => s.payments);
  const { getUserName, addOrUpdateUser } = useUserStore();
  const allUsers = useUserStore(s => s.users);

  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [sinApp, setSinApp] = useState(false);

  const contactosDisponibles = useMemo(
    () => allUsers.filter(u =>
      !u.isDeleted && !esYo(u.id) && !(group?.memberIds ?? []).includes(u.id),
    ),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allUsers, group, currentUser],
  );

  function handleAddContact(userId: string) {
    if (!group) return;
    hapticSuccess();
    updateGroup(group.id, { memberIds: [...group.memberIds, userId] });
    ensureKey(group.id);
    void announceGroupToContacts(group.id);
    setInviteVisible(false);
  }

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

  const gastosDelTimeline = timeline.flatMap(i => (i.type === 'expense' ? [i.data] : []));
  const pagosDelTimeline  = timeline.flatMap(i => (i.type === 'payment' ? [i.data] : []));
  const marcaDeGasto = useRecordTrust('expense', gastosDelTimeline);
  const marcaDePago  = useRecordTrust('payment', pagosDelTimeline);

  const balances    = useGroupBalance(id ?? '', currentUser?.id ?? '');

  /**
   * El «2 de 3» cuenta las aprobaciones que VERIFICAN (T-065), igual que el que
   * decide aplicar la salida. Si contara las crudas, un pedido con aprobaciones
   * forjadas mostraría «3 de 3» y no pasaría nada nunca — el peor de los
   * mundos: la pantalla diciendo que está listo y la app sin moverse.
   *
   * Se memoiza contra el pedido: son como mucho tantas verificaciones como
   * miembros, y sólo mientras hay una salida pendiente.
   */
  const avance = useMemo(() => {
    if (!group?.leaveRequest) return { got: 0, need: 0 };
    return approvalProgress(group, group.leaveRequest, a =>
      verifyLeaveApproval(group.id, group.leaveRequest!, a, authorKeysFor(a.userId, a.k)) === 'valida',
    );
  }, [group]);
  const mainBalance = balances.find(b => b.currency === group?.currency)?.amount ?? 0;

  const [menuVisible, setMenuVisible] = useState(false);

  async function handleShareInvite() {
    if (!group || !currentUser) return;
    hapticLight();
    ensureKey(group.id);
    const identidad = ensureIdentity();
    const invite = createInvite(group.id, group.name, identidad.publicKey);
    saveInvite(invite);
    void startRelay();
    try {
      await Share.share({
        message: t('group_detail.invite_message', { group: group.name, link: inviteToLink(invite) }),
      });
    } catch { /* el usuario canceló el share sheet */ }
  }

  function handleLeave() {
    if (!group || !currentUser) return;

    const otros = group.memberIds.filter(mid => !esYo(mid));
    const veredicto = canLeaveGroup(
      balances.map(b => ({ currency: b.currency, amount: b.amount })),
      otros,
    );

    if (veredicto.kind === 'last_member_with_balance') {
      Alert.alert(t('group_detail.leave_blocked_title'), t('group_detail.leave_last_member'));
      return;
    }

    if (veredicto.kind === 'needs_absorption') {
      Alert.alert(
        t('group_detail.leave_blocked_title'),
        t('group_detail.leave_needs_settle', { currencies: veredicto.currencies.join(', ') }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('group_detail.settle_debts'), onPress: () => router.push(`/settle/new?groupId=${group.id}` as any) },
          { text: t('leave.title'), onPress: () => router.push(`/groups/leave?id=${group.id}` as any) },
        ],
      );
      return;
    }

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
  }

  function handleAddMember() {
    const name = inviteName.trim();
    if (!name || !group) return;

    const newUser = {
      id:           uuidv4(),
      name,
      email:        '',
      authProvider: 'google' as const,
      updatedAt:    syncedNow(),
      isDeleted:    false,
      createdAt:    Date.now(),
    };

    addOrUpdateUser(newUser);
    updateGroup(group.id, { memberIds: [...group.memberIds, newUser.id] });
    ensureKey(group.id);
    void announceGroupToContacts(group.id);
    hapticSuccess();
    setInviteName('');
    setInviteVisible(false);
    setSinApp(false);
    Alert.alert(t('group_detail.member_added_title'), t('group_detail.without_app_warning'));
  }

  if (!group) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
        <DetailHeader title="" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('group_detail.not_found')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const balanceColor = mainBalance > 0 ? c.semantic.positive
    : mainBalance < 0 ? c.semantic.negative
    : c.textSecondary;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <DetailHeader
        title={group.name}
        onBack={() => router.back()}
        right={
          <Pressable
            testID="group-options"
            accessibilityRole="button"
            accessibilityLabel={t('group_detail.options')}
            onPress={() => setMenuVisible(true)}
            hitSlop={12}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
        {falloDeSync && (
          <SyncWarningBanner
            title={t('sync.failure_title')}
            body={t(claveDeFalloDeSync(falloDeSync.reason))}
          />
        )}

        {/* Balance: banda, no tarjeta. La cifra es lo primero que se lee. */}
        <Band>
          <View style={styles.balancePad}>
            <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
              {t('group_detail.balance_label')}
            </Text>
            <Text style={[Typography.amountXL, { color: balanceColor, marginTop: 2 }]}>
              {mainBalance > 0 ? '+' : ''}{formatMoney(mainBalance, group.currency)}
            </Text>
            <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 4 }]}>
              {mainBalance > 0 ? t('group_detail.owe_you')
                : mainBalance < 0 ? t('group_detail.you_owe_short')
                : t('group_detail.settled_up')}
            </Text>
          </View>
        </Band>

        {/* Miembros */}
        <SectionLabel label={t('group_detail.members_label', { count: group.memberIds.length })} />
        <Band>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.members}>
            {group.memberIds.map(uid => (
              <View key={uid} style={{ alignItems: 'center', gap: 5, width: 56 }}>
                <UserAvatar userId={uid} name={getUserName(uid)} size={40} />
                <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
                  {getUserName(uid).split(' ')[0]}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Band>

        {/* Timeline */}
        <SectionLabel label={t('group_detail.activity_label', { count: timeline.length })} />
        {timeline.length === 0 ? (
          <Band>
            <View style={styles.emptyBox}>
              <Ionicons name="receipt-outline" size={26} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8 }]}>
                {t('group_detail.no_activity')}
              </Text>
            </View>
          </Band>
        ) : (
          <Band>
            {timeline.map((item, i) =>
              item.type === 'expense' ? (
                <ExpenseRow
                  key={item.data.id}
                  expense={item.data}
                  currentUserId={currentUser?.id ?? ''}
                  getUserName={getUserName}
                  trust={marcaDeGasto[item.data.id]}
                  last={i === timeline.length - 1}
                />
              ) : (
                <PaymentRow
                  key={item.data.id}
                  payment={item.data}
                  currentUserId={currentUser?.id ?? ''}
                  getUserName={getUserName}
                  trust={marcaDePago[item.data.id]}
                  last={i === timeline.length - 1}
                />
              ),
            )}
          </Band>
        )}

        {/* Pedido de salida pendiente */}
        {group?.leaveRequest && currentUser && (
          <>
            <SectionLabel label={t('leave.title')} />
            <Band>
              <View style={[styles.leaveNote, { backgroundColor: c.semantic.warningSoft }]}>
                <Ionicons name="warning-outline" size={15} color={c.semantic.warning} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[Typography.bodyS, { color: c.semantic.warning, fontWeight: '700' }]}>
                    {esYo(group.leaveRequest.userId)
                      ? t('leave.pending_mine', { got: avance.got, need: avance.need })
                      : t('leave.pending_title', { name: getUserName(group.leaveRequest.userId) })}
                  </Text>
                  {!esYo(group.leaveRequest.userId) && (
                    <Text style={[Typography.caption, { color: c.semantic.warning }]}>
                      {t('leave.pending_body', { got: avance.got, need: avance.need })}
                    </Text>
                  )}
                </View>
              </View>

              {esYo(group.leaveRequest.userId) ? (
                <BandRow onPress={() => cancelLeave(group.id)} last>
                  <Text style={[Typography.bodyL, { color: c.textSecondary, flex: 1, textAlign: 'center' }]}>
                    {t('leave.withdraw')}
                  </Text>
                </BandRow>
              ) : !yaAprobo(group.leaveRequest, currentUser.id) && (
                <BandRow
                  last
                  onPress={() => {
                    hapticSuccess();
                    approveLeave(group.id, currentUser.id);
                    applyApprovedLeaves();
                  }}
                >
                  <View style={styles.approveRow}>
                    <Ionicons name="checkmark-circle-outline" size={18} color={c.brand.primary} />
                    <Text style={[Typography.bodyL, { color: c.brand.primary }]}>{t('leave.approve')}</Text>
                  </View>
                </BandRow>
              )}
            </Band>
          </>
        )}
      </ScrollView>

      {group && currentUser && group.memberIds.some(esYo) && (
        <FabRow>
          {tieneGastos && (
            <Fab
              testID="settle-debts"
              variant="secondary"
              icon="swap-horizontal-outline"
              label={t('group_detail.settle_debts')}
              onPress={() => { hapticLight(); router.push(`/settle/new?groupId=${group.id}` as any); }}
              backgroundColor={c.brand.primarySoft}
              borderColor={c.hair}
              iconColor={c.brand.primary}
              textColor={c.brand.primary}
            />
          )}
          <Fab
            testID="add-expense"
            icon="add"
            label={t('group_detail.add_expense')}
            onPress={() => {
              hapticLight();
              router.push({ pathname: '/expense/new', params: { groupId: id } } as any);
            }}
            backgroundColor={c.brand.primary}
          />
        </FabRow>
      )}

      <BottomSheet visible={menuVisible} onClose={() => setMenuVisible(false)}>
        {group && currentUser && group.memberIds.some(esYo) && (
          <>
            <SheetOption
              icon="person-add-outline"
              label={t('group_detail.add_person')}
              selected={false}
              onPress={() => { setMenuVisible(false); setInviteVisible(true); }}
            />
            <SheetOption
              icon="link-outline"
              label={t('group_detail.invite_link')}
              selected={false}
              onPress={() => { setMenuVisible(false); void handleShareInvite(); }}
            />
          </>
        )}
        {group && currentUser && (
          esYo(group.createdById) ? (
            <SheetOption
              icon="trash-outline"
              label={t('group_detail.delete_group')}
              selected={false}
              onPress={() => {
                setMenuVisible(false);
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
            />
          ) : (
            <SheetOption
              icon="exit-outline"
              label={t('group_detail.leave_group')}
              selected={false}
              onPress={() => { setMenuVisible(false); handleLeave(); }}
            />
          )
        )}
      </BottomSheet>

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
              <View style={[styles.handle, { backgroundColor: c.hair }]} />

              <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>
                {t('group_detail.add_member_title')}
              </Text>

              {contactosDisponibles.length > 0 && (
                <>
                  <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 12 }]}>
                    {t('group_detail.add_from_contacts')}
                  </Text>
                  {contactosDisponibles.map(u => (
                    <SheetOptionAvatar
                      key={u.id}
                      userId={u.id}
                      name={u.name}
                      selected={false}
                      onPress={() => handleAddContact(u.id)}
                    />
                  ))}
                </>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={() => setSinApp(v => !v)}
                style={{ marginTop: contactosDisponibles.length > 0 ? Spacing[5] : 0, marginBottom: Spacing[2] }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: c.brand.primary }}>
                  {t('group_detail.add_without_app')}
                </Text>
              </Pressable>

              {sinApp && (
                <>
                  <Text style={[Typography.caption, { color: c.textSecondary, marginBottom: 12 }]}>
                    {t('group_detail.without_app_warning')}
                  </Text>
                  <TextInput
                    value={inviteName}
                    onChangeText={setInviteName}
                    placeholder={t('group_detail.name_placeholder')}
                    placeholderTextColor={c.textTertiary}
                    style={[styles.input, { backgroundColor: c.bgGrouped, color: c.text, borderColor: c.hair }]}
                    returnKeyType="done"
                    onSubmitEditing={handleAddMember}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleAddMember}
                    style={[styles.confirmBtn, {
                      backgroundColor: inviteName.trim() ? c.brand.primary : c.bgGrouped,
                    }]}
                  >
                    <Text style={{
                      fontSize: 15, fontWeight: '700',
                      color: inviteName.trim() ? '#fff' : c.textTertiary,
                    }}>
                      {t('group_detail.add_to_group')}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ExpenseRow({
  expense, currentUserId, getUserName, trust, last,
}: {
  expense: Expense;
  currentUserId: string;
  getUserName: (id: string) => string;
  trust?: TrustState;
  last?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const myShare   = expense.splits.find(s => mismaPersona(s.userId, currentUserId));
  const isPayer   = mismaPersona(expense.paidById, currentUserId);
  const dateLabel = new Date(expense.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const netForMe  = isPayer
    ? expense.amount - (myShare?.amount ?? 0)
    : -(myShare?.amount ?? 0);

  return (
    <BandRow last={last} onPress={() => router.push(`/expense/${expense.id}` as any)}>
      <View style={[styles.rowIcon, { backgroundColor: c.hair2 }]}>
        <Ionicons name="receipt-outline" size={17} color={c.textTertiary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {expense.description}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
          {getUserName(expense.paidById)} · {dateLabel}
        </Text>
        {isMarked(trust ?? 'pendiente') && <TrustMark label={t('trust.badge')} size="sm" />}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[Typography.amountS, {
          color: netForMe > 0 ? c.semantic.positive : netForMe < 0 ? c.semantic.negative : c.textTertiary,
        }]}>
          {netForMe > 0 ? '+' : ''}{formatMoney(netForMe, expense.currency)}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {t('group_detail.total_suffix', { amount: formatMoney(expense.amount, expense.currency) })}
        </Text>
      </View>
    </BandRow>
  );
}

function PaymentRow({
  payment, currentUserId, getUserName, trust, last,
}: {
  payment: Payment;
  currentUserId: string;
  getUserName: (id: string) => string;
  trust?: TrustState;
  last?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const acuse     = useSaldadoAcuse(payment, currentUserId);
  const fromName  = mismaPersona(payment.fromUserId, currentUserId) ? t('common.you') : getUserName(payment.fromUserId);
  const toName    = mismaPersona(payment.toUserId, currentUserId)   ? t('common.you') : getUserName(payment.toUserId);
  const dateLabel = new Date(payment.date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  // T-064: sin acuse, el saldado NO se pinta como cerrado.
  const cerrado  = acuse.estado === 'efectivo';
  const negativo = acuse.estado === 'rechazado';
  const tono     = negativo ? c.semantic.negative : cerrado ? c.semantic.positive : c.textTertiary;
  const colorDelMonto = negativo ? c.semantic.negative : cerrado ? c.semantic.positive : c.textSecondary;

  return (
    <BandRow last={last}>
      <View style={[styles.rowIcon, { backgroundColor: cerrado ? c.semantic.positiveSoft : c.hair2 }]}>
        <Ionicons
          name={negativo ? 'close-circle-outline' : cerrado ? 'checkmark-circle-outline' : 'time-outline'}
          size={17}
          color={tono}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>
          {t('group_detail.paid_to', { from: fromName, to: toName })}
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>
          {t('group_detail.payment_label')} · {dateLabel}
        </Text>
        {isMarked(trust ?? 'pendiente') && <TrustMark label={t('trust.badge')} size="sm" />}
        <SettlementAcuse
          testID={`acuse-${payment.id}`}
          estado={acuse.estado}
          meToca={acuse.meToca}
          nombreDeQuienCobra={toName}
          onConfirmar={acuse.confirmar}
          onRechazar={acuse.rechazar}
        />
      </View>
      <Text style={[Typography.amountS, { color: colorDelMonto }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    </BandRow>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  upper:       { textTransform: 'uppercase' },
  balancePad:  { paddingHorizontal: Spacing.screenPad, paddingTop: 18, paddingBottom: 18 },
  members:     { paddingHorizontal: Spacing.screenPad, paddingVertical: 14, gap: 14 },
  emptyBox:    { alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
  rowIcon:     { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  leaveNote:   {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  approveRow:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  modalRoot:   { flex: 1, justifyContent: 'flex-end' },
  sheet:       { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  handle:      { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  input:       {
    height: 50, borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 16, marginBottom: 14,
  },
  confirmBtn:  { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
