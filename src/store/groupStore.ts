import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import type { Group } from '@/src/types/models';

const storage = createSecureStorage('groups');
const KEY = 'data_v1';

interface GroupStoreState {
  groups: Group[];
  isLoading: boolean;
  getById: (id: string) => Group | undefined;
  addGroup: (group: Group) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  mergeGroups: (incoming: Group[]) => void;
  hydrate: () => void;
}

function persist(groups: Group[]) {
  writeScoped(storage, KEY, JSON.stringify(groups));
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: [],
  isLoading: true,

  getById: (id) => get().groups.find(g => g.id === id),

  addGroup: (group) => {
    const groups = [...get().groups, group];
    persist(groups);
    set({ groups });
  },

  updateGroup: (id, patch) => {
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g,
    );
    persist(groups);
    set({ groups });
  },

  // LWW merge para sync P2P — gana el registro con mayor updatedAt
  mergeGroups: (incoming) => {
    const current = get().groups;
    const merged = [...current];
    for (const inc of incoming) {
      const idx = merged.findIndex(g => g.id === inc.id);
      if (idx === -1) {
        merged.push(inc);
      } else if (inc.updatedAt > merged[idx].updatedAt) {
        merged[idx] = inc;
      }
    }
    persist(merged);
    set({ groups: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    const groups = raw ? (JSON.parse(raw) as Group[]) : [];
    set({ groups, isLoading: false });
  },
}));
