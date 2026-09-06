import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';
import { deletionRound, msUntilDeletion } from '@/src/algorithms/deletionRound';
import { requiereConfirmacion } from '@/src/algorithms/settlementStatus';
// Sólo el tipo: `publishHealth` no puede entrar al grafo de módulos de acá.
import type { BlockingReason } from '@/src/sync/publishHealth';

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
  /**
   * Alguien pidió borrar un gasto y hay que opinar.
   *
   * `expenseId` es de T-071: sin él, la bandeja no puede volver a mirar la
   * ronda para saber cuánto falta de verdad — sólo tiene la foto congelada
   * del momento en que se avisó. **Opcional a propósito**: un `Notice`
   * guardado ANTES de este cambio no lo tiene y no se recalcula
   * (`noticeInboxStore.ts:14-18`), así que sigue existiendo sin él para
   * siempre. Todo lo que lo lee tiene que andar igual sin `expenseId`.
   */
  | { kind: 'deletion'; groupId: string; groupName: string; description: string; expenseId?: string }
  /**
   * Alguien deshizo un borrado que este teléfono ya había aplicado.
   *
   * Es la contraparte que faltaba: avisar el borrado y callar la restauración
   * dejaba al usuario creyendo enterrado un gasto que volvió a contar en su
   * balance. La mala noticia llegaba y la buena no.
   */
  | { kind: 'restored'; groupId: string; groupName: string; description: string }
  /** Entramos a un grupo nuevo (nos entregaron la clave). */
  | { kind: 'joined'; groupId: string; groupName: string }
  /**
   * Alguien registró un saldo que me involucra (ADR-006, decisión 5).
   *
   * Sólo avisa de lo que registró OTRO: un pago propio ya se conoce, y avisarlo
   * sería contarle al usuario algo que acaba de hacer.
   */
  | { kind: 'settled'; groupId: string; groupName: string; amount: number; currency: CurrencyCode }
  /**
   * Alguien dice que me pagó y **falta que yo lo confirme** (T-064).
   *
   * Es el mismo evento que `settled` visto desde el otro lado del mostrador, y
   * por eso son excluyentes: en un grupo consensuado, quien cobra recibe ESTE
   * aviso —que pide una acción— y no el otro, que sólo informa. Mandar los dos
   * por un solo pago sería contarle dos veces lo mismo y dejarle sin saber cuál
   * atender.
   *
   * Es el único aviso de la bandeja que pide hacer algo, y sin él D2 del plan
   * —el pendiente no vence nunca— deja al saldado esperando a alguien que no se
   * enteró de que lo esperan.
   */
  | { kind: 'settlement_pending'; groupId: string; groupName: string; paymentId: string;
      amount: number; currency: CurrencyCode }
  /**
   * Este grupo dejó de sincronizar por algo que NO se arregla esperando
   * (T-058). El banner del detalle del grupo ya lo dice, pero es contextual: si
   * no entrás a ESE grupo, no te enterás de que tus gastos no le están llegando
   * a nadie. Es el caso donde no saber sale más caro.
   *
   * Quién decide que una caída merece aviso —y que avise UNA vez y no una por
   * intento— vive en `sync/syncDownNotices.ts`.
   */
  | { kind: 'sync_down'; groupId: string; groupName: string; reason: BlockingReason }
  /**
   * El reloj del teléfono está mal por más de cinco minutos (T-038).
   *
   * El merge ya está corregido —`syncedNow()` lo compensa contra el relay— pero
   * **las fechas que el usuario ve salen del reloj del aparato** y ésas no se
   * corrigen solas. Quién decide que avise UNA vez vive en `sync/clockNotice.ts`.
   */
  | { kind: 'clock_off'; offsetMs: number };

/**
 * ¿Este aviso pide que el usuario HAGA algo, o sólo informa? (T-062)
 *
 * Sólo `deletion`, `settlement_pending` y `sync_down` tienen algo que el
 * usuario deba resolver; el resto es historia. Switch exhaustivo A PROPÓSITO,
 * sin `default`: el tipo de retorno obliga a cubrir los siete casos, así que
 * agregar un `kind` a `Notice` sin decidir acá no compila (mismo patrón que
 * `claveDeFalloDeSync` en `sync/useSyncFailure.ts`).
 *
 * Es la cuarta vez que este repo necesita esta clasificación — T-055, T-057,
 * T-060 y la clasificación por descarte de T-063 — y todas las anteriores
 * eran una lista aparte que se desincronizaba del tipo. Ésta no puede.
 */
export function esAccionable(kind: Notice['kind']): boolean {
  switch (kind) {
    case 'deletion':
    case 'settlement_pending':
    case 'sync_down':
    // Accionable aunque lo que hay que hacer esté FUERA de la app: si se
    // clasificara como historia, el usuario no arreglaría nunca la hora y
    // seguiría viendo fechas equivocadas sin saber por qué.
    case 'clock_off':
      return true;
    case 'expenses':
    case 'settled':
    case 'restored':
    case 'joined':
      return false;
  }
}

export type Snapshot = {
  /** Ids de gastos vivos conocidos ANTES de la bajada. */
  expenseIds: string[];
  /** Ids de gastos que ya tenían una ronda de borrado abierta. */
  conBorradoAbierto: string[];
  /** Ids de pagos vivos conocidos ANTES. Sin esto, un saldo entraba al balance sin anunciarse. */
  paymentIds: string[];
  /**
   * Ids de gastos que este teléfono tenía BORRADOS.
   *
   * Es lo que convierte una restauración en un evento en vez de un estado: sin
   * esto, un device que entra tarde y baja el historial completo anunciaría
   * restauraciones de hace meses como si acabaran de pasar.
   */
  borrados: string[];
};

/** Una ronda abierta es la que existe, todavía no venció y nadie objetó. */
function borradoPendiente(e: Expense, now: number): boolean {
  const ronda = deletionRound(e, now);
  return ronda !== null && ronda.status === 'open' && ronda.expiresAt > now;
}

export function snapshot(expenses: Expense[], now: number, payments: Payment[] = []): Snapshot {
  const vivos = expenses.filter(e => !e.isDeleted);
  return {
    expenseIds: vivos.map(e => e.id),
    conBorradoAbierto: vivos.filter(e => borradoPendiente(e, now)).map(e => e.id),
    paymentIds: payments.filter(p => !p.isDeleted).map(p => p.id),
    borrados: expenses.filter(e => e.isDeleted).map(e => e.id),
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
  const teniaBorrados = new Set(before.borrados);
  const nombre = (id: string) => groups.find(g => g.id === id)?.name ?? '';

  // Un grupo que no está en la lista no es mío: no se avisa nada de él.
  const mios = new Set(groups.filter(g => !g.isDeleted).map(g => g.id));

  const nuevosPorGrupo = new Map<string, number>();
  const pedidosDeBorrado: Notice[] = [];
  const restauraciones: Notice[] = [];

  for (const e of expensesAfter) {
    if (e.isDeleted || !mios.has(e.groupId)) continue;

    // Regla 1: lo que cargué yo no se avisa, aunque vuelva por el sync.
    // Y lo que yo tenía borrado y volvió no es NUEVO: es el mismo de antes.
    // Sin esa segunda mitad, una restauración salía por duplicado — «1 gasto
    // nuevo» y «lo restauraron» por el mismo evento.
    if (!conocidos.has(e.id) && !teniaBorrados.has(e.id) && e.createdById !== currentUserId) {
      nuevosPorGrupo.set(e.groupId, (nuevosPorGrupo.get(e.groupId) ?? 0) + 1);
    }

    // Un pedido de borrado que se abrió en esta bajada. El que lo pidió ya sabe.
    if (!yaAbiertos.has(e.id) && borradoPendiente(e, now)) {
      // El que lo pidió ya sabe: no se le avisa de su propia solicitud.
      if (deletionRound(e, now)!.requestedBy !== currentUserId) {
        pedidosDeBorrado.push({
          kind: 'deletion',
          groupId: e.groupId,
          groupName: nombre(e.groupId),
          description: e.description,
          expenseId: e.id,
        });
      }
    }

    /**
     * Un gasto que ACABA de volver de estar borrado.
     *
     * La condición que lo hace un evento es `teniaBorrados`: tiene que haber
     * estado borrado en ESTE teléfono. Mirar sólo el estado de la ronda
     * avisaría de nuevo en cada recálculo, y le anunciaría a un device recién
     * llegado restauraciones que pasaron hace meses.
     *
     * **Antes también exigía que la ronda quedara en `restored`, y eso dejaba
     * un camino mudo** (T-061): un peer que manda `isDeleted: false` con un
     * `updatedAt` mayor —LWW puro, sin voto de restauración— hace reaparecer el
     * gasto sin abrir ninguna ronda. El gasto volvía a contar en el balance y
     * no se enteraba nadie. Es el caso MÁS necesitado de aviso, no el menos:
     * cuando hay voto por lo menos queda quién y por qué.
     *
     * El arreglo saca una condición en vez de agregar un caso. Llegar acá ya
     * significa que el gasto está vivo —el `continue` de arriba descarta los
     * borrados— y `teniaBorrados` significa que antes no lo estaba. Eso ES la
     * restauración. Lo único que sigue exceptuado es haberla hecho uno mismo.
     */
    if (teniaBorrados.has(e.id)) {
      const ronda = deletionRound(e, now);
      const loRestauréYo = ronda?.status === 'restored' && ronda.stoppedBy === currentUserId;
      if (!loRestauréYo) {
        restauraciones.push({
          kind: 'restored',
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
    .map((p): Notice => {
      // En un grupo consensuado, quien COBRA no recibe un aviso informativo:
      // recibe el que le pide confirmar. Ver `settlement_pending`.
      const grupo = groups.find(g => g.id === p.groupId);
      if (p.toUserId === currentUserId && requiereConfirmacion(p, grupo)) {
        return {
          kind: 'settlement_pending' as const,
          groupId: p.groupId,
          groupName: nombre(p.groupId),
          paymentId: p.id,
          amount: p.amount,
          currency: p.currency,
        };
      }
      return {
        kind: 'settled' as const,
        groupId: p.groupId,
        groupName: nombre(p.groupId),
        amount: p.amount,
        currency: p.currency,
      };
    });

  return [...porGastos, ...pedidosDeBorrado, ...restauraciones, ...saldos];
}

/**
 * Cuánto falta para que se aplique un pedido de borrado, mirado HOY — no
 * cuando se generó el `Notice` (T-071).
 *
 * El `Notice` guardado es una copia CONGELADA (`noticeInboxStore.ts:14-18`):
 * esto no la relee a ella, relee el GASTO, que sí es una fuente viva. Por
 * eso hace falta el `expenses` del store y un `now` explícito, igual que
 * `deletionRound` (T-059): sin reloj no hay forma de saber si la ronda que
 * abrió el aviso sigue siendo la vigente.
 *
 * `null` es "no hay nada que prometer", y pasa por CUALQUIERA de estas
 * razones — no se distinguen porque a la fila le da lo mismo cuál fue:
 *  - El aviso es de antes de T-071 y no tiene `expenseId`.
 *  - El gasto ya no está vivo en el store (se fue, o directo no está).
 *  - La ronda que abrió el aviso dejó de estar `open` (la objetaron, se
 *    restauró) o ya venció — vencida no promete un plazo que no existe.
 */
export function msRestanteDeBorrado(
  notice: Notice, expenses: readonly Expense[], now: number,
): number | null {
  if (notice.kind !== 'deletion' || notice.expenseId === undefined) return null;
  const expense = expenses.find(e => e.id === notice.expenseId);
  if (!expense || expense.isDeleted) return null;
  const ronda = deletionRound(expense, now);
  if (ronda === null || ronda.status !== 'open') return null;
  const restante = msUntilDeletion(ronda, now);
  return restante > 0 ? restante : null;
}
