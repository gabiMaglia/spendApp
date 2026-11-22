import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/src/constants/currencies';
import { pagosDelReparto, repartoParejo, type Acreedor } from '@/src/algorithms/repartoSaldo';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { hapticExito, hapticAdvertencia } from '@/src/utils/haptics';
import { useMomentoExito } from '@/src/hooks/useMomentoExito';
import { useUserStore } from '@/src/store/userStore';
import { armarPago } from '@/src/screens/settle/armarPago';
import type { Payment, User } from '@/src/types/models';

/**
 * Guardar el saldo: un pago, o uno por acreedor en modo "todo". T-223: salió
 * de `app/settle/new.tsx` tal cual.
 */
export function useGuardarSaldo({
  canSave, exceedsMax, currentUser, modoTodo, acreedores, amount,
  groupId, fromId, toId, currency, date, addPayment,
}: {
  canSave: boolean;
  exceedsMax: boolean;
  currentUser: User | null;
  modoTodo: boolean;
  acreedores: Acreedor[];
  amount: number;
  groupId: string;
  fromId: string;
  toId: string;
  currency: CurrencyCode;
  date: Date;
  addPayment: (p: Payment) => void;
}) {
  const { t } = useTranslation();
  const { momento, mostrar } = useMomentoExito();

  // La pantalla sigue ahí hasta que `MomentoExito` termina y navega (T-290).
  function cerrarConMomento(pagos: Payment[]) {
    const total = pagos.reduce((suma, p) => suma + p.amount, 0);
    const aQuien = pagos.length === 0 ? ''
      : pagos.length > 1
        ? t('settle.done_to_many', { count: pagos.length })
        : t('settle.done_to', { name: useUserStore.getState().getUserName(pagos[0].toUserId) });
    mostrar({ montos: [{ minor: total, code: currency }], titulo: t('settle.done_title'), detalle: aQuien });
  }

  function handleSave() {
    if (!canSave || !currentUser) return;
    if (exceedsMax) { hapticAdvertencia(); return; }

    // Modo "todo": un pago por acreedor. Si el monto no cubre la deuda entera,
    // se reparte parejo — la app OFRECE ese reparto, no lo impone: el usuario
    // puede volver al modo de a uno y decidir a quién le da cuánto.
    if (modoTodo) {
      const reparto = repartoParejo(acreedores, amount);
      const pagos = pagosDelReparto(reparto, currentUser.id, groupId, currency)
        .map(pago => armarPago(pago, date, currentUser.id));
      // T-178 (6.4): el mismo predicado que hoy sólo corre al publicar/recibir
      // corre ACÁ antes de escribir. Si cualquier pago del reparto excede, no
      // se escribe ninguno — nada de guardar la mitad de un reparto.
      const motivo = pagos.map(motivoDeExceso).find(m => m !== null) ?? null;
      if (motivo) {
        Alert.alert(t('sync.record_too_big_title'), t(motivo));
        return;
      }
      hapticExito();
      for (const pago of pagos) addPayment(pago);
      cerrarConMomento(pagos);
      return;
    }

    const nuevo = armarPago(
      { groupId, fromUserId: fromId, toUserId: toId, amount, currency }, date, currentUser.id,
    );
    const motivo = motivoDeExceso(nuevo);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }
    hapticExito();
    addPayment(nuevo);
    cerrarConMomento([nuevo]);
  }

  return { handleSave, momento };
}
