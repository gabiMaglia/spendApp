import { mergeDeletionVotes, DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import type { DeletionVote, Expense } from '@/src/types/models';

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

export type DeletionRound = {
  /** Quién pidió el borrado (el pedido más viejo de la ronda). */
  requestedBy: string;
  requestedAt: number;
  /** Cuándo se borraría solo si nadie objeta. */
  expiresAt: number;
  /** Alguien objetó: la ronda está muerta, no se va a borrar. */
  objected: boolean;
  objectedBy?: string;
};

/** `null` si no hay ninguna solicitud abierta. */
export function deletionRound(expense: Expense): DeletionRound | null {
  const votos = mergeDeletionVotes(expense.deletionVotes ?? []);

  const pedidos = votos.filter(v => v.action === 'delete');
  if (pedidos.length === 0) return null;

  // El más viejo define el vencimiento: es desde cuándo la gente tuvo aviso.
  const primero = pedidos.reduce((a, b) => (a.votedAt <= b.votedAt ? a : b));
  const objecion = votos.find(v => v.action === 'cancel');

  return {
    requestedBy: primero.userId,
    requestedAt: primero.votedAt,
    expiresAt: primero.votedAt + DELETION_TIMEOUT_MS,
    objected: objecion !== undefined,
    objectedBy: objecion?.userId,
  };
}

/**
 * Los votos después de que `userId` frena la ronda: objetar, retirar su pedido
 * o restaurar un gasto ya borrado.
 *
 * **Frenar es AGREGAR un voto, no sacar los que hay.** Hasta S6 las tres
 * pantallas quitaban votos del array —restaurar lo vaciaba entero—, y eso
 * funcionaba sólo porque el merge pisaba el conjunto: el que tuviera el
 * `updatedAt` mayor se imponía. Desde el merge por niveles (T-041 · S7) el
 * conjunto se UNE, y una ausencia no se puede distinguir de un voto que
 * todavía no nos llegó. Sacar un voto ahora no frena nada: vuelve del primer
 * peer que sincronice y el gasto se re-borra solo.
 *
 * Lo que sí viaja es un voto. El mío reemplaza al mío anterior —`votedAt`
 * mayor, y `mergeDeletionVotes` colapsa por `userId`—, así que retirar mi
 * pedido y objetar terminan en el mismo lugar.
 *
 * **Consecuencia declarada:** retirar el pedido deja la ronda como OBJETADA y
 * no como "nunca pedida". Con un pedido de otra persona vivo, retirar el mío ya
 * no lo deja seguir corriendo. Es más restrictivo que antes y erra hacia no
 * borrar; distinguir "me saco" de "me opongo" necesita una acción propia en
 * `DeletionVote`, que es S8.
 */
export function votosAlCancelar(
  votos: readonly DeletionVote[] | undefined,
  userId: string,
  now: number,
): DeletionVote[] {
  return [
    ...(votos ?? []).filter(v => v.userId !== userId),
    { userId, votedAt: now, action: 'cancel' },
  ];
}

/** Milisegundos que faltan para el borrado automático. 0 si ya venció. */
export function msUntilDeletion(round: DeletionRound, now: number = Date.now()): number {
  return Math.max(0, round.expiresAt - now);
}

/** ¿Esta persona ya objetó esta ronda? */
export function hasObjected(expense: Expense, userId: string): boolean {
  return mergeDeletionVotes(expense.deletionVotes ?? [])
    .some(v => v.userId === userId && v.action === 'cancel');
}

/** ¿Esta persona es quien pidió el borrado? */
export function hasRequested(expense: Expense, userId: string): boolean {
  return mergeDeletionVotes(expense.deletionVotes ?? [])
    .some(v => v.userId === userId && v.action === 'delete');
}
