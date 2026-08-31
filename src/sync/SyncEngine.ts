import { canonical } from '@/src/store/lww';
import type { DeletionVote, Expense, SyncMeta } from '@/src/types/models';

/** Ventana para objetar un borrado (regla de negocio #2). */
export const DELETION_TIMEOUT_MS = 72 * 60 * 60 * 1000;

export class SyncEngine {
  /**
   * Last-Write-Wins merge por `updatedAt`.
   * Si isDeleted=true con updatedAt mayor, el borrado se propaga.
   */
  mergeData<T extends SyncMeta>(local: T[], remote: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of local)  map.set(item.id, item);
    for (const item of remote) {
      const existing = map.get(item.id);
      if (!existing || item.updatedAt > existing.updatedAt) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  /**
   * Delta: solo registros más nuevos que el último sync del peer.
   */
  buildDelta<T extends SyncMeta>(allRecords: T[], peerLastSync: number): T[] {
    return allRecords.filter(r => r.updatedAt > peerLastSync);
  }
}

// ── Borrado consensuado ──────────────────────────────────────────────────────

/**
 * Desde cuándo cuenta la ronda abierta en este conjunto.
 *
 * La ronda la abre el pedido de borrado más VIEJO del conjunto — es la misma
 * definición que ya usa `deletionRound()` para calcular el vencimiento, y es
 * desde cuándo la gente tuvo aviso. `undefined` = no hay ninguna ronda abierta.
 */
function aperturaDeRonda(votes: readonly DeletionVote[]): number | undefined {
  let apertura: number | undefined;
  for (const v of votes) {
    if (v.action !== 'delete') continue;
    if (apertura === undefined || v.votedAt < apertura) apertura = v.votedAt;
  }
  return apertura;
}

/**
 * **Une dos versiones del conjunto de votos** (T-041 · S7).
 *
 * Los votos son el nivel COLABORATIVO del registro: los escriben terceros que
 * no tienen la privada del autor. Resolverlos por el LWW del registro entero
 * —lo que se hacía hasta S6— hace que el voto de Beto desaparezca en cuanto Ana
 * edita su gasto sin haberlo visto, porque su copia gana por `updatedAt` y se
 * lleva puesto el conjunto. Nadie se entera: el borrado simplemente no ocurre.
 *
 * Pero unir a secas rompe la regla #2, y ahí está la parte delicada: pedir el
 * borrado **arranca de cero a propósito** (`app/expense/[id].tsx`). Con una
 * unión ciega, una objeción vieja bloquearía todo pedido futuro y —peor— un
 * pedido viejo volvería con su `votedAt` original y vencería al instante,
 * borrando un gasto sin darle a nadie sus 72hs.
 *
 * Por eso la unión es **por ronda**: se unen los votos de la ronda más nueva y
 * los anteriores a su apertura no se arrastran. Es el mismo criterio que
 * `mergeApprovals` ya usa para las aprobaciones de salida — se une adentro de
 * la ronda, y entre rondas gana la última.
 *
 * El resultado sale ORDENADO y sin duplicados: los dos dispositivos tienen que
 * guardar exactamente el mismo array, o el desempate canónico del LWW elegiría
 * distinto en cada uno.
 */
export function mergeDeletionVoteSets(
  a: readonly DeletionVote[] | undefined,
  b: readonly DeletionVote[] | undefined,
): DeletionVote[] {
  const A = a ?? [];
  const B = b ?? [];

  const apA = aperturaDeRonda(A);
  const apB = aperturaDeRonda(B);
  const desde = apA === undefined ? apB : apB === undefined ? apA : Math.max(apA, apB);

  const porContenido = new Map<string, DeletionVote>();
  for (const v of [...A, ...B]) {
    if (desde !== undefined && v.votedAt < desde) continue;
    porContenido.set(canonical(v), v);
  }

  return [...porContenido]
    .sort(([ka, va], [kb, vb]) => va.votedAt - vb.votedAt || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, v]) => v);
}

/**
 * Merge de votos por userId: gana el de mayor votedAt.
 */
export function mergeDeletionVotes(votes: DeletionVote[]): DeletionVote[] {
  const map = new Map<string, DeletionVote>();
  for (const vote of votes) {
    const existing = map.get(vote.userId);
    if (!existing || vote.votedAt > existing.votedAt) {
      map.set(vote.userId, vote);
    }
  }
  return Array.from(map.values());
}

/**
 * Determina si un gasto debe borrarse definitivamente.
 * Reglas:
 *  1. El creador puede forzar el borrado inmediato (forced=true).
 *  2. Si algún miembro votó 'cancel', el borrado no procede.
 *  3. Si hay al menos un voto 'delete' y pasaron 72hs sin objeciones, se borra.
 */
export function resolveDeletionVotes(
  expense: Expense,
  _memberIds: string[],
  now: number = Date.now(),
): boolean {
  const latestVotes = mergeDeletionVotes(expense.deletionVotes ?? []);

  // El creador puede forzar borrado inmediato (regla #2, y R3 del PO: se honra
  // SIEMPRE, verifique su firma o no).
  //
  // Salvo que alguien lo haya DESHECHO después. Sin esta condición, restaurar
  // un borrado forzado no funciona nunca: desde S7 el conjunto de votos se une
  // en vez de pisarse, así que el `forced` sobrevive para siempre y
  // `resolvePendingDeletions` vuelve a borrar el gasto en el próximo arranque.
  // No debilita el override —al forzarlo, borra— sino que le da la contraparte
  // que el PO pidió junto con él: deshacer en un toque.
  const creatorVote = latestVotes.find(v => v.userId === expense.createdById);
  if (creatorVote?.action === 'delete' && creatorVote.forced) {
    const deshecho = latestVotes.some(
      v => v.action === 'cancel' && v.votedAt > creatorVote.votedAt,
    );
    if (!deshecho) return true;
  }

  // Si hay algún voto de cancelación, no borrar
  const hasCancelVote = latestVotes.some(v => v.action === 'cancel');
  if (hasCancelVote) return false;

  // Timeout: ¿hay voto de borrado y pasaron 72hs?
  const deleteVotes = latestVotes.filter(v => v.action === 'delete');
  if (deleteVotes.length > 0) {
    const oldest = Math.min(...deleteVotes.map(v => v.votedAt));
    return now - oldest > DELETION_TIMEOUT_MS;
  }

  return false;
}
