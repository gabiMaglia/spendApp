import { mergeDeletionVotes, DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import { accionDe, rondaVigente } from '@/src/sync/voteCore';
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

/** `null` si no hay ninguna solicitud abierta. */
export function deletionRound(expense: Expense): DeletionRound | null {
  const ronda = rondaVigente(mergeDeletionVotes(expense.deletionVotes ?? []));
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
export function msUntilDeletion(round: DeletionRound, now: number = Date.now()): number {
  return Math.max(0, round.expiresAt - now);
}

/** ¿El último enunciado de esta persona es una objeción? */
export function hasObjected(expense: Expense, userId: string): boolean {
  return mergeDeletionVotes(expense.deletionVotes ?? [])
    .some(v => v.userId === userId && accionDe(v) === 'object');
}

/** ¿Esta persona es quien pidió el borrado y no lo retiró? */
export function hasRequested(expense: Expense, userId: string): boolean {
  return mergeDeletionVotes(expense.deletionVotes ?? [])
    .some(v => v.userId === userId && accionDe(v) === 'delete');
}
