import { privadaDelAparato } from '@/src/sync/devicePrivateKey';
import { signSettlement } from '@/src/sync/settlementSign';
import { requiereConfirmacion } from '@/src/algorithms/settlementStatus';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupStore } from '@/src/store/groupStore';
import { syncedNow } from '@/src/utils/syncedClock';
import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

/**
 * **Emitir el acuse de recibo de un saldado** (T-064).
 *
 * Único punto de escritura de `confirmations` en toda la app. La lección es de
 * `deletionVotes.ts`: cuando tres pantallas escriben el mismo array, terminan
 * escribiendo cosas distintas sin que nadie lo note.
 *
 * **La invariante que no se negocia: acusar es AGREGAR, nunca sacar.** El array
 * se UNE en el merge (`mergeLevels`), así que una ausencia no se distingue de
 * un acuse que todavía no llegó: borrar un rechazo no lo frena, vuelve del
 * primer peer que sincronice. Lo único que se saca es **mi propio acuse
 * anterior**, que el derivador ya daba por reemplazado y que sólo haría crecer
 * el array.
 */

export type AccionDeAcuse = 'confirm' | 'reject';

/** Firma el enunciado, o lo deja sin firmar. Nunca rompe la acción del usuario. */
function firmar(paymentId: string, acuse: SettlementConfirmation): SettlementConfirmation {
  const priv = privadaDelAparato();
  if (!priv) return acuse;

  try {
    return { ...acuse, ...signSettlement(paymentId, acuse, priv) };
  } catch {
    // Una firma que no cierra se leería como suplantación y acusaría a quien
    // acusó recibo de buena fe. Sin firma es `no_verificable`, que es la verdad.
    return acuse;
  }
}

/**
 * ¿Puede esta persona acusar recibo de este pago?
 *
 * Sólo quien cobra, y sólo cuando el pago lo declaró otro. Un tercero no puede
 * dar por recibida una plata que no recibió él, y el derivador ya ignora esos
 * acuses — pero conviene no escribirlos, porque un array lleno de acuses que no
 * valen es ruido que viaja en cada sobre (T-058).
 */
export function puedeAcusar(payment: Payment, group: Group | undefined, userId: string): boolean {
  if (payment.isDeleted) return false;
  if (!requiereConfirmacion(payment, group)) return false;
  return payment.toUserId === userId;
}

/**
 * Los acuses que quedan después de que `userId` hace `accion`.
 *
 * Devuelve el array nuevo; no escribe. Quien escribe es el store, en una sola
 * llamada, para que no haya un estado intermedio donde el pago quedó sin acuses.
 */
export function emitirAcuse(
  payment: Payment,
  userId: string,
  accion: AccionDeAcuse,
  now: number,
): SettlementConfirmation[] {
  const acuse = firmar(payment.id, { userId, confirmedAt: now, action: accion });

  // Fuera SÓLO el mío anterior. El de los demás se conserva entero: el
  // derivador sabe cuál manda, y perder el de otro sería perder información
  // que este teléfono no tiene cómo recuperar.
  const ajenos = (payment.confirmations ?? []).filter(c => c.userId !== userId);
  return [...ajenos, acuse];
}

/**
 * Acusar recibo (o rechazar) desde la UI. Devuelve si escribió algo.
 *
 * Orquesta acá y no adentro de `paymentStore` para que el store de pagos no
 * tenga que importar el de grupos: ese grafo ya tiene ciclos de require, y el
 * store de pagos está en el camino del merge.
 */
export function acusarRecibo(
  paymentId: string, userId: string, accion: AccionDeAcuse, now: number = syncedNow(),
): boolean {
  const payment = usePaymentStore.getState().payments.find(p => p.id === paymentId);
  if (!payment) return false;

  const group = useGroupStore.getState().groups.find(g => g.id === payment.groupId);
  if (!puedeAcusar(payment, group, userId)) return false;

  usePaymentStore.getState().updatePayment(paymentId, {
    confirmations: emitirAcuse(payment, userId, accion, now),
  });
  return true;
}
