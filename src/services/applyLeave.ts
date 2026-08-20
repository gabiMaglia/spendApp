import { v4 as uuidv4 } from 'uuid';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { isApprovedByAll } from '@/src/algorithms/leaveRequest';
import type { Group } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * Aplica los pedidos de salida que ya juntaron todas las aprobaciones.
 *
 * El reparto del saldo se materializa como **pagos**, no como un concepto nuevo:
 * un `Payment` ya mueve saldo entre dos personas y todo lo demás —balances,
 * simplificación de deudas, sync— ya sabe tratarlos. Ver `planAbsorption`.
 *
 * Corre en el arranque y después de cada sync, igual que la resolución de
 * borrados: la aprobación que falta puede llegar del otro teléfono en cualquier
 * momento, y el que se va bien puede tener la app cerrada.
 *
 * **Idempotente por construcción**: al aplicar se limpia el pedido, así que una
 * segunda pasada no encuentra nada. Los ids de los pagos son nuevos cada vez,
 * así que aplicar dos veces DUPLICARÍA el reparto — por eso limpiar el pedido
 * es parte de la misma operación y no un paso aparte.
 */
export function applyApprovedLeaves(now: number = syncedNow()): number {
  const store = useGroupStore.getState();

  const listos: Group[] = store.groups.filter(g =>
    !g.isDeleted && g.leaveRequest !== undefined && isApprovedByAll(g, g.leaveRequest),
  );

  for (const group of listos) {
    const req = group.leaveRequest!;

    for (const p of req.plan) {
      usePaymentStore.getState().addPayment({
        id:          uuidv4(),
        groupId:     group.id,
        fromUserId:  p.fromUserId,
        toUserId:    p.toUserId,
        amount:      p.amount,
        currency:    p.currency,
        date:        now,
        createdAt:   now,
        createdById: req.userId,
        updatedAt:   now,
        isDeleted:   false,
      });
    }

    // Sacar el pedido y al que se va, en una sola escritura: si quedaran
    // separadas y la app muriera en el medio, el pedido volvería a aplicarse y
    // duplicaría los pagos.
    store.updateGroup(group.id, {
      leaveRequest: undefined,
      memberIds: group.memberIds.filter(id => id !== req.userId),
    });
  }

  return listos.length;
}
