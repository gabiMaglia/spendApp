import type { SyncMeta } from '@/src/types/models';

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
