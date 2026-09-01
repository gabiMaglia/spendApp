import { deletionRound } from '@/src/algorithms/deletionRound';
import { privadaDelAparato } from '@/src/sync/devicePrivateKey';
import { roundIdFor } from '@/src/sync/voteCore';
import { signVote } from '@/src/sync/voteSign';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **Emitir un voto de la ronda de borrado** (T-041 · S8).
 *
 * Único punto de escritura de `deletionVotes` en toda la app. Las cinco
 * acciones pasaban antes por tres pantallas y dos helpers distintos, y así fue
 * como objetar, retirar y restaurar terminaron escribiendo exactamente el mismo
 * voto sin que nadie lo notara.
 *
 * **La invariante que no se negocia: frenar es AGREGAR un voto, nunca sacar los
 * que hay.** Hasta S6 las pantallas quitaban votos del array —restaurar lo
 * vaciaba entero— y eso funcionaba sólo porque el merge PISABA el conjunto.
 * Desde el merge por niveles (S7) el conjunto se UNE, y una ausencia no se
 * distingue de un voto que todavía no llegó: sacar un voto no frena nada,
 * vuelve del primer peer que sincronice —con su `votedAt` original, o sea con
 * las 72hs ya vencidas— y el gasto se borra solo.
 *
 * Lo único que se saca es **mi propio voto anterior**, que no es lo mismo: el
 * colapso por `(roundId, userId)` ya lo daba por reemplazado, y dejarlo sólo
 * haría crecer el array. El de los demás se conserva entero, y hay un test que
 * lo exige acción por acción.
 */

export type AccionDeVoto =
  /** Pedir el borrado: abre una ronda nueva. */
  | 'delete'
  /** El override del creador (regla #2): se borra ya. Se honra siempre (R3). */
  | 'force'
  /** Objetar: frena la ronda de todos, y queda quién fue. */
  | 'object'
  /** Retirar MI pedido. Si otra persona sigue queriendo borrar, la ronda sigue. */
  | 'withdraw'
  /** Deshacer un borrado ya aplicado. */
  | 'restore';

/**
 * El token que viaja para el que no actualizó.
 *
 * Objetar y restaurar tienen que frenar también allá, y ese lado sólo conoce
 * `delete` y `cancel`: una acción que no conoce es un voto que no frena nada.
 * `withdraw` sí puede ser un token propio — allá es un voto que no dice nada, y
 * "no dice nada" es justo el resultado correcto.
 */
const TOKEN: Record<AccionDeVoto, DeletionVote['action']> = {
  delete: 'delete',
  force: 'delete',
  object: 'cancel',
  withdraw: 'withdraw',
  restore: 'cancel',
};

/** Firma el enunciado, o lo deja sin firmar. Nunca rompe la acción del usuario. */
function firmar(expenseId: string, voto: DeletionVote): DeletionVote {
  const priv = privadaDelAparato();
  if (!priv) return voto;

  try {
    return { ...voto, ...signVote(expenseId, voto, priv) };
  } catch {
    // Una firma que no cierra se leería como suplantación y acusaría a quien
    // votó de buena fe. Sin firma es `no_verificable`, que es la verdad.
    return voto;
  }
}

/**
 * Los votos que quedan después de que `userId` hace `accion`.
 *
 * Pedir el borrado ARRANCA DE CERO a propósito: si los votos se acumularan,
 * una objeción vieja bloquearía cualquier pedido futuro para siempre, y un
 * pedido viejo que sobreviviera vencería al instante al reabrirse — borrando
 * sin darle a nadie sus 72hs. Lo que la unión del merge protege es lo de
 * ADENTRO de la ronda; abrir una nueva sigue siendo empezar limpio.
 */
export function emitirVoto(
  expense: Expense,
  userId: string,
  accion: AccionDeVoto,
  now: number,
): DeletionVote[] {
  const abre = accion === 'delete' || accion === 'force';

  // Un voto que frena habla de LA ronda vigente: se firma contra su `roundId`,
  // así que no se puede sacar de ahí para revivir otra. `undefined` cuando no
  // hay ronda o cuando la abrió alguien anterior a S8, que es la ronda `''`.
  const roundId = abre
    ? roundIdFor(expense.id, userId, now)
    : deletionRound(expense)?.roundId || undefined;

  const voto: DeletionVote = {
    userId,
    votedAt: now,
    action: TOKEN[accion],
    ...(accion === 'restore' ? { intent: 'restore' as const } : {}),
    ...(roundId ? { roundId } : {}),
    ...(accion === 'force' ? { forced: true } : {}),
  };

  const firmado = firmar(expense.id, voto);
  if (abre) return [firmado];

  return [...(expense.deletionVotes ?? []).filter(v => v.userId !== userId), firmado];
}
