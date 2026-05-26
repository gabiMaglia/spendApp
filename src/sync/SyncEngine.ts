import type { DeletionVote, Expense, SyncMeta } from '@/src/types/models';

const DELETION_TIMEOUT_MS = 72 * 60 * 60 * 1000;

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
export function resolveDeletionVotes(expense: Expense, _memberIds: string[]): boolean {
  const latestVotes = mergeDeletionVotes(expense.deletionVotes);

  // El creador puede forzar borrado inmediato
  const creatorVote = latestVotes.find(v => v.userId === expense.createdById);
  if (creatorVote?.action === 'delete' && creatorVote.forced) return true;

  // Si hay algún voto de cancelación, no borrar
  const hasCancelVote = latestVotes.some(v => v.action === 'cancel');
  if (hasCancelVote) return false;

  // Timeout: ¿hay voto de borrado y pasaron 72hs?
  const deleteVotes = latestVotes.filter(v => v.action === 'delete');
  if (deleteVotes.length > 0) {
    const oldest = Math.min(...deleteVotes.map(v => v.votedAt));
    return Date.now() - oldest > DELETION_TIMEOUT_MS;
  }

  return false;
}
