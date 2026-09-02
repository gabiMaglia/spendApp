import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { isApprovedByAll } from '@/src/algorithms/leaveRequest';
import { authorKeysFor } from '@/src/sync/authorKeys';
import { verifyLeaveApproval } from '@/src/sync/leaveApprovalSign';
import type { Group, LeaveRequest } from '@/src/types/models';
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
 * **Idempotente en los dos ejes**: limpiar el pedido evita repetir en ESTE
 * dispositivo, y el id derivado (ver `idDelPago`) evita duplicar entre dos que
 * resuelven la misma salida sin haberse visto. Hacen falta los dos: el primero
 * solo protegía contra la segunda pasada local.
 */
/**
 * Id DERIVADO del pedido, no aleatorio.
 *
 * Esta función corre en TODOS los dispositivos —al arrancar y después de cada
 * sync— y antes usaba `uuidv4()`. Dos teléfonos que resolvían la misma salida
 * sin haberse visto generaban pagos con ids distintos: al mergear sobrevivían
 * los dos y **el reparto se aplicaba dos veces**. Limpiar el pedido en la misma
 * escritura protegía contra repetir en UN device, no contra dos.
 *
 * Con el id derivado de datos que los dos ya comparten, el merge por id los
 * colapsa solo. `requestedAt` distingue una segunda salida del mismo usuario;
 * el índice, dos pagos del mismo plan.
 */
function idDelPago(groupId: string, req: LeaveRequest, i: number): string {
  return `leave:${groupId}:${req.userId}:${req.requestedAt}:${i}`;
}

export function applyApprovedLeaves(now: number = syncedNow()): number {
  const store = useGroupStore.getState();

  /**
   * **Acá la firma AUTORIZA, no informa** (T-065).
   *
   * Es la excepción declarada a la política del PO de marcar y nunca rechazar
   * (R1 de T-041), y la razón es concreta: marcar sirve cuando la persona puede
   * juzgar lo que ve, y esto ocurre solo —al arrancar y después de cada sync,
   * en el teléfono de todos— materializando pagos que mueven saldo. No hay
   * nadie mirando cuando pasa.
   *
   * Sin esto, quien se va escribe los ids de todos los demás en `approvedBy`
   * —el conjunto se une sin preguntar quién escribió cada entrada— y la salida
   * se aprueba sola. Reproducido con test antes de tocar nada.
   *
   * El costo es acotado: como mucho una verificación por miembro del grupo, y
   * sólo cuando hay un pedido de salida vivo. No es el camino del merge, donde
   * los 18 ms por operación sí importarían (D9).
   */
  const verificaAprobacion = (grupo: Group) => (a: Parameters<typeof verifyLeaveApproval>[2]) =>
    verifyLeaveApproval(
      grupo.id, grupo.leaveRequest!, a, authorKeysFor(a.userId, a.k),
    ) === 'valida';

  const listos: Group[] = store.groups.filter(g =>
    !g.isDeleted
    && g.leaveRequest !== undefined
    && isApprovedByAll(g, g.leaveRequest, verificaAprobacion(g)),
  );

  for (const group of listos) {
    const req = group.leaveRequest!;

    /**
     * `derived: true` — estos pagos NO se firman (T-041 · S5).
     *
     * El `createdById` es el del que SE VA y esto corre en el device de
     * cualquiera: firmarlos sería declarar autoría ajena. Y cuando el que
     * resuelve es el propio saliente, firmarlos dejaría el MISMO id circulando
     * firmado desde un teléfono y sin firma desde los otros. El modelo de un
     * registro derivado es `derivedFrom` sobre el `LeaveRequest` firmado, y es
     * S9 del plan.
     */
    req.plan.forEach((p, i) => {
      usePaymentStore.getState().addPayment({
        id:          idDelPago(group.id, req, i),
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
      }, { derived: true });
    });

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
