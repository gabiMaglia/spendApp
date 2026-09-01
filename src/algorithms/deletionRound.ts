import { mergeDeletionVotes, DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import { accionDe, esDeLaRonda, rondaVigente } from '@/src/sync/voteCore';
import type { Expense } from '@/src/types/models';

/**
 * Estado de una solicitud de borrado (regla de negocio #2).
 *
 * Cada solicitud abre una RONDA: quien pide arranca de cero, y una objeción la
 * mata. Sin eso el flujo se traba — un `cancel` viejo bloquearía para siempre
 * cualquier pedido futuro, y un `delete` viejo que sobreviviera a la objeción
 * vencería al instante al reabrirse, borrando sin darle a nadie las 72hs.
 *
 * La ronda vive en `deletionVotes`, que viaja por el sync como cualquier campo:
 * los dos lados ven lo mismo sin nada especial.
 */

/** En qué quedó la ronda. `restored` y `objected` no son lo mismo (R-Q2). */
export type DeletionRoundStatus =
  /** Corriendo: si nadie la frena, el gasto se borra al vencer. */
  | 'open'
  /** Alguien objetó: el gasto no se borra hasta que se pida de nuevo. */
  | 'objected'
  /** Alguien deshizo un borrado ya aplicado. */
  | 'restored';

export type DeletionRound = {
  /** Contra qué ronda se firman los votos. `''` = lo anterior a S8. */
  roundId: string;
  /** Quién pidió el borrado (el pedido más viejo de la ronda). */
  requestedBy: string;
  requestedAt: number;
  /** Cuándo se borraría solo si nadie objeta. */
  expiresAt: number;
  status: DeletionRoundStatus;
  /** Quién la frenó, cuando la frenaron. */
  stoppedBy?: string;
};

/**
 * `null` si no hay ninguna solicitud abierta.
 *
 * **`now` es obligatorio y no tiene default a propósito** (T-059). Leer la
 * ronda dejó de ser una decisión sólo sobre el conjunto: un `votedAt` posterior
 * a *ahora* no puede ser el enunciado vigente, y sin un reloj no hay forma de
 * saber cuál es cuál. En producción se pasa `syncedNow()` (ADR-005); un default
 * acá lo dejaría salir del reloj del teléfono sin que se note.
 */
export function deletionRound(expense: Expense, now: number): DeletionRound | null {
  const ronda = rondaVigente(mergeDeletionVotes(expense.deletionVotes ?? [], now), now);
  if (ronda === null) return null;

  const { apertura, freno } = ronda;
  return {
    roundId: ronda.roundId,
    requestedBy: apertura.userId,
    requestedAt: apertura.votedAt,
    expiresAt: apertura.votedAt + DELETION_TIMEOUT_MS,
    status: freno === undefined ? 'open' : accionDe(freno) === 'restore' ? 'restored' : 'objected',
    stoppedBy: freno?.userId,
  };
}

/** Milisegundos que faltan para el borrado automático. 0 si ya venció. */
export function msUntilDeletion(round: DeletionRound, now: number): number {
  return Math.max(0, round.expiresAt - now);
}

/**
 * ¿El último enunciado de esta persona EN LA RONDA VIGENTE es lo que se
 * pregunta?
 *
 * Acotado a la ronda a propósito (T-059). Antes alcanzaba con mirar el conjunto
 * entero porque la poda del merge dejaba una sola ronda; desde que las rondas
 * nombradas conviven, no acotar haría que una objeción de una ronda ya cerrada
 * dijera «ya objetaste» en la de ahora y le escondiera el botón a alguien que
 * todavía no dijo nada.
 */
function enLaRonda(
  expense: Expense, userId: string, now: number, accion: 'object' | 'delete',
): boolean {
  const vigentes = mergeDeletionVotes(expense.deletionVotes ?? [], now);
  const ronda = rondaVigente(vigentes, now);
  if (ronda === null) return false;

  return vigentes.some(v =>
    v.userId === userId && accionDe(v) === accion && esDeLaRonda(v, ronda.roundId));
}

/** ¿El último enunciado de esta persona es una objeción? */
export function hasObjected(expense: Expense, userId: string, now: number): boolean {
  return enLaRonda(expense, userId, now, 'object');
}

/** ¿Esta persona es quien pidió el borrado y no lo retiró? */
export function hasRequested(expense: Expense, userId: string, now: number): boolean {
  return enLaRonda(expense, userId, now, 'delete');
}
