import { Alert, Share } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { hapticLight, hapticSuccess } from '@/src/utils/haptics';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createInvite, inviteToLink } from '@/src/sync/invitaciones/groupInvite';
import { ensureIdentity, saveInvite } from '@/src/store/identityStore';
import { startRelay } from '@/src/sync/motor/relayEngine';
import { canLeaveGroup } from '@/src/algorithms/canLeaveGroup';
import { salirDelGrupo } from '@/src/services/salirDelGrupo';
import { esYo } from '@/src/store/identityAlias';
import { expulsar } from '@/src/services/expulsarDelGrupo';
import { saldoPendienteDe } from '@/src/screens/groupDetail/detalleDeGrupo';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * Invitar por link, salir y expulsar: las acciones del detalle de grupo que
 * confirman con un `Alert`. T-223: salió de `app/groups/[id].tsx`.
 */
export function useAccionesDeGrupo({
  group, currentUser, balances, allExpenses, allPayments, getUserName,
}: {
  group: Group | undefined;
  currentUser: User | null;
  balances: { currency: CurrencyCode; amount: number }[];
  allExpenses: Expense[];
  allPayments: Payment[];
  getUserName: (id: string) => string;
}) {
  const { t } = useTranslation();
  const ensureKey = useGroupKeyStore(st => st.ensureKey);

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
          onPress: () => {
            // Por el servicio y no por `leaveGroup` suelto: hay un orden que
            // importa —publicar la salida, marcar, y recién ahí purgar la copia
            // local— y está explicado en `salirDelGrupo` (T-089).
            void salirDelGrupo(group.id, currentUser.id);
            router.back();
          },
        },
      ],
    );
  }

  /**
   * Expulsar (T-182 Task 2). Sólo el creador la ve, y nunca sobre sí mismo —
   * las dos condiciones se chequean acá Y de nuevo adentro de `expulsar()`
   * (que es la autoridad real; esto es sólo para no ofrecer un botón que
   * el servicio va a rechazar).
   */
  function handleExpel(uid: string) {
    if (!group || !currentUser || !esYo(group.createdById) || uid === group.createdById) return;

    const saldoDelExpulsado = saldoPendienteDe(uid, allExpenses, allPayments, group);

    const nombre = getUserName(uid);
    const cuerpo = saldoDelExpulsado.length > 0
      ? t('group_detail.expel_body_with_balance', {
          name: nombre,
          amounts: saldoDelExpulsado.map(b => formatMoney(Math.abs(b.amount), b.currency)).join(', '),
        })
      : t('group_detail.expel_body', { name: nombre });

    Alert.alert(
      t('group_detail.expel_title', { name: nombre }),
      cuerpo,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('group_detail.expel_confirm'),
          style: 'destructive',
          onPress: () => {
            const resultado = expulsar(group.id, uid);
            if (resultado === 'ok') hapticSuccess();
          },
        },
      ],
    );
  }

  return { handleShareInvite, handleLeave, handleExpel };
}
