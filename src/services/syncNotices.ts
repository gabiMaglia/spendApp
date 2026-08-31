import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';
import { deletionRound } from '@/src/algorithms/deletionRound';

/**
 * Qué avisar después de un sync (T-010).
 *
 * Es la mitad PURA de las notificaciones: mira el antes y el después de una
 * bajada y decide qué merece un aviso. La entrega (permiso, expo-notifications,
 * preferencias) vive en `notifications.ts`. La separación es a propósito —
 * decidir qué avisar es la parte con reglas, y las reglas se testean.
 *
 * Tres reglas mandan sobre todo lo demás:
 *
 *  1. **Lo propio nunca se avisa.** Un gasto que cargué yo vuelve por el sync
 *     como cualquier otro registro. Avisarlo sería notificarle al usuario algo
 *     que acaba de hacer con el teléfono en la mano.
 *  2. **Se agrega, no se repite.** Entrar a un grupo con 50 gastos tiene que
 *     producir UN aviso, no 50. Es la diferencia entre una app que avisa y una
 *     que se vuelve insoportable el primer día.
 *  3. **Sólo lo que apareció en ESTA bajada.** El antes/después es lo que
 *     distingue "nuevo" de "ya estaba"; sin eso, cada relectura por cursor
 *     volvería a avisar lo mismo.
 */

export type Notice =
  /** Llegaron gastos ajenos a un grupo. */
  | { kind: 'expenses'; groupId: string; groupName: string; count: number }
  /** Alguien pidió borrar un gasto y hay que opinar. */
  | { kind: 'deletion'; groupId: string; groupName: string; description: string }
  /** Entramos a un grupo nuevo (nos entregaron la clave). */
  | { kind: 'joined'; groupId: string; groupName: string }
  /**
   * Alguien registró un saldo que me involucra (ADR-006, decisión 5).
   *
   * Sólo avisa de lo que registró OTRO: un pago propio ya se conoce, y avisarlo
   * sería contarle al usuario algo que acaba de hacer.
   */
  | { kind: 'settled'; groupId: string; groupName: string; amount: number; currency: CurrencyCode };

export type Snapshot = {
  /** Ids de gastos vivos conocidos ANTES de la bajada. */
  expenseIds: string[];
  /** Ids de gastos que ya tenían una ronda de borrado abierta. */
  conBorradoAbierto: string[];
  /** Ids de pagos vivos conocidos ANTES. Sin esto, un saldo entraba al balance sin anunciarse. */
  paymentIds: string[];
};

/** Una ronda abierta es la que existe, todavía no venció y nadie objetó. */
function borradoPendiente(e: Expense, now: number): boolean {
  const ronda = deletionRound(e);
  return ronda !== null && !ronda.objected && ronda.expiresAt > now;
}

export function snapshot(expenses: Expense[], now: number, payments: Payment[] = []): Snapshot {
  const vivos = expenses.filter(e => !e.isDeleted);
  return {
    expenseIds: vivos.map(e => e.id),
    conBorradoAbierto: vivos.filter(e => borradoPendiente(e, now)).map(e => e.id),
    paymentIds: payments.filter(p => !p.isDeleted).map(p => p.id),
  };
}

/**
 * Compara el antes con el después y arma los avisos.
 *
 * `joined` no sale de comparar: lo informa el canal de contactos, que es quien
 * sabe que acaba de adoptar una clave.
 */
export function noticesFor(
  before: Snapshot,
  expensesAfter: Expense[],
  groups: Group[],
  currentUserId: string,
  now: number,
  paymentsAfter: Payment[] = [],
): Notice[] {
  const conocidos = new Set(before.expenseIds);
  const yaAbiertos = new Set(before.conBorradoAbierto);
  const nombre = (id: string) => groups.find(g => g.id === id)?.name ?? '';

  // Un grupo que no está en la lista no es mío: no se avisa nada de él.
  const mios = new Set(groups.filter(g => !g.isDeleted).map(g => g.id));

  const nuevosPorGrupo = new Map<string, number>();
  const borrados: Notice[] = [];

  for (const e of expensesAfter) {
    if (e.isDeleted || !mios.has(e.groupId)) continue;

    // Regla 1: lo que cargué yo no se avisa, aunque vuelva por el sync.
    if (!conocidos.has(e.id) && e.createdById !== currentUserId) {
      nuevosPorGrupo.set(e.groupId, (nuevosPorGrupo.get(e.groupId) ?? 0) + 1);
    }

    // Un pedido de borrado que se abrió en esta bajada. El que lo pidió ya sabe.
    if (!yaAbiertos.has(e.id) && borradoPendiente(e, now)) {
      // El que lo pidió ya sabe: no se le avisa de su propia solicitud.
      if (deletionRound(e)!.requestedBy !== currentUserId) {
        borrados.push({
          kind: 'deletion',
          groupId: e.groupId,
          groupName: nombre(e.groupId),
          description: e.description,
        });
      }
    }
  }

  // Regla 2: uno por grupo con el total, no uno por gasto.
  const porGastos: Notice[] = [...nuevosPorGrupo.entries()].map(([groupId, count]) => ({
    kind: 'expenses' as const,
    groupId,
    groupName: nombre(groupId),
    count,
  }));

  /**
   * Saldos que registró OTRO y me involucran.
   *
   * `createdById !== yo` es la condición que importa: un pago propio ya se
   * conoce, y avisarlo sería contarle al usuario algo que acaba de hacer. Se
   * avisa en las DOS direcciones —me pagaron, o registraron que yo pagué—
   * porque en ambas alguien tocó mi saldo sin que yo estuviera mirando.
   */
  const conocidos_pagos = new Set(before.paymentIds);
  const saldos: Notice[] = paymentsAfter
    .filter(p =>
      !p.isDeleted &&
      !conocidos_pagos.has(p.id) &&
      mios.has(p.groupId) &&
      p.createdById !== currentUserId &&
      (p.fromUserId === currentUserId || p.toUserId === currentUserId))
    .map(p => ({
      kind: 'settled' as const,
      groupId: p.groupId,
      groupName: nombre(p.groupId),
      amount: p.amount,
      currency: p.currency,
    }));

  return [...porGastos, ...borrados, ...saldos];
}
