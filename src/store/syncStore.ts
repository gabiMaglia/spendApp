import { create } from 'zustand';
import type { SyncState } from '@/src/components/SyncStatusBadge';

interface SyncStoreState {
  state: SyncState;
  lastSyncAt: number | null;
  setState: (state: SyncState) => void;
  setLastSyncAt: (ts: number) => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  state: 'offline',
  lastSyncAt: null,
  setState: (state) => set({ state }),
  setLastSyncAt: (ts) => set({ lastSyncAt: ts }),
}));
