import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/src/constants/currencies';
import { pagosDelReparto, repartoParejo, type Acreedor } from '@/src/algorithms/repartoSaldo';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { hapticSuccess, hapticWarning } from '@/src/utils/haptics';
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

  return function handleSave() {
    if (!canSave || !currentUser) return;
    if (exceedsMax) { hapticWarning(); return; }

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
      hapticSuccess();
      for (const pago of pagos) addPayment(pago);
      router.back();
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
    hapticSuccess();
    addPayment(nuevo);
    router.back();
  };
}
