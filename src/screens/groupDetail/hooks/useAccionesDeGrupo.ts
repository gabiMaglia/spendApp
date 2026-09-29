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
import { esYo, idCanonico } from '@/src/store/identityAlias';
import { expulsar } from '@/src/services/expulsarDelGrupo';
import { totalesDeUsuario } from '@/src/algorithms/deudasDelGrupo';
import {
  cuentasPorPersona, deudasDeGrupo, saldoPendienteDe, saldosParaSalir, type CuentasConPersona,
} from '@/src/screens/groupDetail/detalleDeGrupo';
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

  /**
   * Las dos direcciones con cada persona, una línea por dirección (T-225, PO
   * 2026-09-29: «siempre avisando… a quién le debés y quién te debe»).
   */
  function lineasDeCuentas(cuentas: CuentasConPersona[]): string {
    const montos = (xs: CuentasConPersona['meDebe']) =>
      xs.map(m => formatMoney(m.amount, m.currency)).join(', ');
    return cuentas.flatMap(c => {
      const name = getUserName(c.userId);
      return [
        ...(c.meDebe.length > 0 ? [t('group_detail.debt_owes_you', { name, amounts: montos(c.meDebe) })] : []),
        ...(c.leDebo.length > 0 ? [t('group_detail.debt_you_owe', { name, amounts: montos(c.leDebo) })] : []),
      ];
    }).join('\n');
  }

  const conLineas = (cuerpo: string, lineas: string) => (lineas ? `${cuerpo}\n\n${lineas}` : cuerpo);

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
    // T-225: salir «con saldo» mira la deuda sin compensar — si debo algo,
    // aunque el neto sea cero — además del neto (ver `saldosParaSalir`).
    const deudas = deudasDeGrupo(allExpenses, allPayments, group);
    const veredicto = canLeaveGroup(
      saldosParaSalir(totalesDeUsuario(deudas, currentUser.id), balances),
      otros,
    );

    if (veredicto.kind === 'last_member_with_balance') {
      Alert.alert(t('group_detail.leave_blocked_title'), t('group_detail.leave_last_member'));
      return;
    }

    if (veredicto.kind === 'needs_absorption') {
      // Repartir entre los que quedan sólo tiene sentido con neto: la pantalla
      // de salida absorbe el neto, y con deudas cruzadas que dan cero no podría
      // cerrar el plan. Ahí queda Saldar lo que debo.
      const hayNeto = balances.some(b => b.amount !== 0);
      Alert.alert(
        t('group_detail.leave_blocked_title'),
        conLineas(
          t('group_detail.leave_needs_settle', { currencies: veredicto.currencies.join(', ') }),
          lineasDeCuentas(cuentasPorPersona(deudas, currentUser.id)),
        ),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('group_detail.settle_debts'), onPress: () => router.push(`/settle/new?groupId=${group.id}` as any) },
          ...(hayNeto
            ? [{ text: t('leave.title'), onPress: () => router.push(`/groups/leave?id=${group.id}` as any) }]
            : []),
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

    // El neto es lo que mueve el pago automático de `expulsar()`; las dos
    // direcciones conmigo (T-225) son lo que el PO quiere ver antes de decidir.
    const saldoDelExpulsado = saldoPendienteDe(uid, allExpenses, allPayments, group);
    const conmigo = cuentasPorPersona(deudasDeGrupo(allExpenses, allPayments, group), currentUser.id)
      .filter(c => c.userId === idCanonico(uid));

    const nombre = getUserName(uid);
    const cuerpo = conLineas(
      saldoDelExpulsado.length > 0
        ? t('group_detail.expel_body_with_balance', {
            name: nombre,
            amounts: saldoDelExpulsado.map(b => formatMoney(Math.abs(b.amount), b.currency)).join(', '),
          })
        : t('group_detail.expel_body', { name: nombre }),
      lineasDeCuentas(conmigo),
    );

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
