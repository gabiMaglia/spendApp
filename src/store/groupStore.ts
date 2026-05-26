import { create } from 'zustand';
import type { Group } from '@/src/types/models';
import MOCK_GROUPS from '@/src/mocks/groups.json';

interface GroupStoreState {
  groups: Group[];
  getById: (id: string) => Group | undefined;
  addGroup: (group: Group) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: MOCK_GROUPS as Group[],

  getById: (id) => get().groups.find(g => g.id === id),

  addGroup: (group) => set(s => ({ groups: [...s.groups, group] })),

  updateGroup: (id, patch) =>
    set(s => ({
      groups: s.groups.map(g => g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g),
    })),
}));
