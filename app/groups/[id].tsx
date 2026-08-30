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
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { createInvite, inviteToLink } from '@/src/sync/groupInvite';
import { ensureIdentity, saveInvite } from '@/src/store/identityStore';
import { startRelay, announceGroupToContacts } from '@/src/sync/relayEngine';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { BalancePill } from '@/src/components/BalancePill';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { canLeaveGroup } from '@/src/algorithms/canLeaveGroup';
import { approvalProgress } from '@/src/algorithms/leaveRequest';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import type { Expense, Payment } from '@/src/types/models';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import { syncedNow } from '@/src/utils/syncedClock';

type TimelineItem =
  | { type: 'expense'; data: Expense; ts: number }
  | { type: 'payment'; data: Payment; ts: number };

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const ensureKey    = useGroupKeyStore(st => st.ensureKey);
  const approveLeave = useGroupStore(st => st.approveLeave);
  const cancelLeave  = useGroupStore(st => st.cancelLeave);
  const deleteGroup = useGroupStore(st => st.deleteGroup);
  const leaveGroup  = useGroupStore(st => st.leaveGroup);
  const group        = useGroupStore(s => s.groups.find(g => g.id === id));
  const updateGroup  = useGroupStore(s => s.updateGroup);
  const allExpenses  = useExpenseStore(s => s.expenses);
  const allPayments  = usePaymentStore(s => s.payments);
  const { getUserName, addOrUpdateUser } = useUserStore();
  const allUsers = useUserStore(s => s.users);

  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [sinApp, setSinApp] = useState(false);

  /** Contactos que todavía no están en el grupo. */
  const contactosDisponibles = useMemo(
    () => allUsers.filter(u =>
      !u.isDeleted && u.id !== currentUser?.id && !(group?.memberIds ?? []).includes(u.id),
    ),
    [allUsers, group, currentUser],
  );

  /**
   * Sumar a un contacto: le llega la clave del grupo por el canal que abrió el
   * QR y el grupo le aparece solo. Esto es lo que "agregar miembro" tenía que
   * haber sido desde el principio.
   */
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

  const balances    = useGroupBalance(id ?? '', currentUser?.id ?? '');
  const avance      = group?.leaveRequest
    ? approvalProgress(group, group.leaveRequest)
    : { got: 0, need: 0 };
  const mainBalance = balances.find(b => b.currency === group?.currency)?.amount ?? 0;

  /**
   * Comparte un link de invitación por el canal que el usuario elija (mail,
   * SMS, copiar, lo que ofrezca el sistema). Es el ÚNICO camino posible para
   * alguien con quien todavía no intercambiaste nada: no hay canal interno por
   * donde avisarle, porque establecerlo es justamente lo que hace la invitación.
   */
  const [menuVisible, setMenuVisible] = useState(false);

  async function handleShareInvite() {
    if (!group || !currentUser) return;
    hapticLight();

    // La clave del grupo se crea acá si no existía: sin ella no hay nada que
    // cifrar y el grupo no puede sincronizarse.
    ensureKey(group.id);
    const identidad = ensureIdentity();

    const invite = createInvite(group.id, group.name, identidad.publicKey);
    saveInvite(invite);

    // Reabre las suscripciones para incluir el buzón de ESTA invitación. Sin
    // esto sólo se escucharían las que existían al arrancar la app, y quien
    // reciba el link se quedaría esperando hasta que reiniciemos.
    void startRelay();

    try {
      await Share.share({
        message: t('group_detail.invite_message', {
          group: group.name,
          link: inviteToLink(invite),
        }),
      });
    } catch { /* el usuario canceló el share sheet */ }
  }

  /**
   * Salir del grupo, con la regla de negocio puesta de verdad.
   *
   * Hasta acá `canLeaveGroup` existía y estaba testeado, pero **no lo llamaba
   * nadie**: se salía con saldo abierto y los números dejaban de cerrar en
   * silencio — al sacarte de `memberIds`, tu saldo desaparece del cálculo y las
   * cuentas de los que quedan ya no suman.
   */
  function handleLeave() {
    if (!group || !currentUser) return;

    const otros = group.memberIds.filter(id => id !== currentUser.id);
    const veredicto = canLeaveGroup(
      balances.map(b => ({ currency: b.currency, amount: b.amount })),
      otros,
    );

    if (veredicto.kind === 'last_member_with_balance') {
      // No hay a quién pasarle el saldo. Ofrecer "salir" acá sería mentir.
      Alert.alert(t('group_detail.leave_blocked_title'), t('group_detail.leave_last_member'));
      return;
    }

    if (veredicto.kind === 'needs_absorption') {
      // Dos salidas posibles y las dos honestas: saldar la deuda, o repartirla
      // entre los que quedan con la aprobación de todos.
      Alert.alert(
        t('group_detail.leave_blocked_title'),
        t('group_detail.leave_needs_settle', {
          currencies: veredicto.currencies.join(', '),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('group_detail.settle_debts'),
            onPress: () => router.push(`/settle/new?groupId=${group.id}` as any),
          },
          {
            text: t('leave.title'),
            onPress: () => router.push(`/groups/leave?id=${group.id}` as any),
          },
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
    Alert.alert(
      t('group_detail.member_added_title'),
      t('group_detail.without_app_warning'),
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
        {/* Todo lo que no es de uso diario vive acá: agregar gente, invitar por
            link y borrar el grupo. Antes estaban sueltos en la pantalla, con
            "eliminar grupo" a un toque de distancia de cualquiera. */}
        <Pressable
          testID="group-options"
          accessibilityRole="button"
          accessibilityLabel={t('group_detail.options')}
          onPress={() => setMenuVisible(true)}
          hitSlop={12}
          style={{ width: 32, alignItems: 'flex-end' }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={c.text} />
        </Pressable>
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

        {/* Pedido de salida pendiente. Todos tienen que aprobar antes de que
            alguien se coma un saldo ajeno. */}
        {group?.leaveRequest && currentUser && (
          <View style={{ paddingHorizontal: Spacing.screenPad, marginTop: Spacing[4] }}>
            <View style={[styles.leaveCard, { backgroundColor: c.semantic.warningSoft, borderColor: c.semantic.warning }]}>
              <Text style={[Typography.bodyM, { color: c.semantic.warning, fontWeight: '600' }]}>
                {group.leaveRequest.userId === currentUser.id
                  ? t('leave.pending_mine', avance)
                  : t('leave.pending_title', { name: getUserName(group.leaveRequest.userId) })}
              </Text>
              {group.leaveRequest.userId !== currentUser.id && (
                <Text style={[Typography.bodyS, { color: c.semantic.warning, marginTop: 2, opacity: 0.9 }]}>
                  {t('leave.pending_body', avance)}
                </Text>
              )}
            </View>

            {group.leaveRequest.userId === currentUser.id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => cancelLeave(group.id)}
                style={[styles.inviteRow, { borderColor: c.borderHair, marginTop: Spacing[2] }]}
              >
                <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
                  {t('leave.withdraw')}
                </Text>
              </Pressable>
            ) : !group.leaveRequest.approvedBy.includes(currentUser.id) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  hapticSuccess();
                  approveLeave(group.id, currentUser.id);
                  // Si la mía era la que faltaba, se aplica ya: hacer esperar
                  // al próximo arranque para algo que acaba de completarse
                  // deja a todos mirando una pantalla que no cambia.
                  applyApprovedLeaves();
                }}
                style={[styles.inviteRow, { borderColor: c.brand.primary, marginTop: Spacing[2] }]}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={c.brand.primary} />
                <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '600' }]}>
                  {t('leave.approve')}
                </Text>
              </Pressable>
            )}
          </View>
        )}

      </ScrollView>

      {/* Botonera fija abajo: la acción principal de la pantalla no puede
          depender de cuánto scrolleaste. Margen inferior de 24 pedido por el
          PO, sobre el padding lateral de siempre. */}
      {/* Antes "agregar gasto" era un FAB flotante en bottom:24 y "saldar" una
          barra abajo: se pisaban. Ahora conviven en la misma botonera, con la
          jerarquía explícita — primary lo que se hace todos los días,
          secondary lo ocasional. */}
      {group && currentUser && group.memberIds.includes(currentUser.id) && (
        <ButtonRack direction="row">
          <ActionButton
            testID="add-expense"
            icon="add"
            label={t('group_detail.add_expense')}
            action={() => {
              hapticLight();
              router.push({ pathname: '/expense/new', params: { groupId: id } } as any);
            }}
          />
          <ActionButton
            testID="settle-debts"
            icon="swap-horizontal-outline"
            variant="secondary"
            label={t('group_detail.settle_debts')}
            action={() => {
              hapticLight();
              router.push(`/settle/new?groupId=${group.id}` as any);
            }}
          />
        </ButtonRack>
      )}

      {/* Menú de los 3 puntos */}
      <BottomSheet visible={menuVisible} onClose={() => setMenuVisible(false)}>
        {group && currentUser && group.memberIds.includes(currentUser.id) && (
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
          group.createdById === currentUser.id ? (
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

              {/* Los contactos van PRIMERO: son los únicos que van a poder ver
                  el grupo de verdad. Antes la única opción era escribir un
                  nombre, que crea a alguien inalcanzable. */}
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

              {/* Alguien que no usa la app. Se puede, pero se dice lo que pasa:
                  entra en los repartos y no va a ver nada. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => setSinApp(v => !v)}
                style={{ marginTop: contactosDisponibles.length > 0 ? Spacing[5] : 0, marginBottom: Spacing[2] }}
              >
                <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '600' }]}>
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
                    style={[styles.input, { backgroundColor: c.surfaceSunken, color: c.text, borderColor: c.border }]}
                    returnKeyType="done"
                    onSubmitEditing={handleAddMember}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleAddMember}
                    style={[styles.confirmBtn, { backgroundColor: inviteName.trim() ? c.brand.primary : c.surfaceSunken }]}
                  >
                    <Text style={[Typography.bodyM, { color: inviteName.trim() ? '#fff' : c.textTertiary, fontWeight: '600' }]}>
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
  inviteRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, padding: 14, borderWidth: 1, borderRadius: 14 },
  leaveCard:  { borderRadius: Radius.md, borderWidth: 1, padding: Spacing[4] },
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
