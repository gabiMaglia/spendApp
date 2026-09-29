import { useMemo } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '@/src/constants/currencies';
import { pagosParaSaldarConAmigo, totalesPorMoneda } from '@/src/algorithms/saldoSinCompensar';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useUserStore } from '@/src/store/userStore';
import { hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import { armarPago } from '@/src/screens/settle/armarPago';

/**
 * Saldar desde Amigos (T-225, PO 2026-09-29): la totalidad de lo que le debo a
 * esa persona, un pago por grupo compartido. Sin parcial, así que el monto no
 * viene de ningún parámetro: sale siempre de las deudas.
 */
export function useSaldoConAmigo(amigoId: string) {
  const { t } = useTranslation();
  const currentUser = useAuthStore(s => s.currentUser);
  const groups      = useGroupStore(s => s.groups);
  const expenses    = useExpenseStore(s => s.expenses);
  const payments    = usePaymentStore(s => s.payments);
  const addPayment  = usePaymentStore(s => s.addPayment);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  // El nombre se resuelve DENTRO del selector: así se re-evalúa cuando cambia el store.
  const nombre      = useUserStore(s => s.getUserName(amigoId));

  const pagos = useMemo(
    () => currentUser
      ? pagosParaSaldarConAmigo({ groups, expenses, payments, archivedIds, yo: currentUser.id, amigo: amigoId })
      : [],
    [groups, expenses, payments, archivedIds, currentUser, amigoId],
  );
  const totales = useMemo(() => totalesPorMoneda(pagos), [pagos]);

  function guardar() {
    if (!currentUser) return;
    const date = new Date();
    const nuevos = pagos.map(p => armarPago(
      { groupId: p.groupId, fromUserId: currentUser.id, toUserId: p.toUserId, amount: p.amount, currency: p.currency },
      date, currentUser.id,
    ));
    // Como en el modo «todo»: si uno excede el tope del sobre, no se escribe
    // ninguno. Saldar a medias desde Amigos dejaría grupos cancelados y otros no.
    const motivo = nuevos.map(motivoDeExceso).find(m => m !== null) ?? null;
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }
    hapticSuccess();
    for (const pago of nuevos) addPayment(pago);
    router.back();
  }

  /** Modal antes de tocar deudas (PO): a quién y cuánto se paga en cada grupo. */
  function confirmar() {
    if (pagos.length === 0) return;
    hapticWarning();
    const detalle = pagos
      .map(p => t('settle.friend_confirm_line', { group: p.groupName, amount: formatMoney(p.amount, p.currency) }))
      .join('\n');
    Alert.alert(
      t('settle.friend_confirm_title', { name: nombre }),
      t('settle.friend_confirm_body', { name: nombre, detalle }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settle.friend_confirm_ok'), onPress: guardar },
      ],
    );
  }

  return { pagos, totales, confirmar, puedeGuardar: pagos.length > 0 && currentUser !== null };
}
