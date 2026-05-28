import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import type { User } from '@/src/types/models';

const storage = createStorage('users');
const KEY = 'data_v1';

interface UserStoreState {
  users: User[];
  getUserById: (id: string) => User | undefined;
  getUserName: (id: string) => string;
  addOrUpdateUser: (user: User) => void;
  removeUser: (id: string) => void;
  mergeUsers: (incoming: User[]) => void;
  hydrate: () => void;
}

function persist(users: User[]) {
  storage.set(KEY, JSON.stringify(users));
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  users: [],

  getUserById: (id) => get().users.find(u => u.id === id),

  getUserName: (id) => get().users.find(u => u.id === id)?.name ?? 'Usuario',

  removeUser: (id) => {
    const users = get().users.map(u =>
      u.id === id ? { ...u, isDeleted: true, updatedAt: Date.now() } : u,
    );
    persist(users);
    set({ users });
  },

  addOrUpdateUser: (user) => {
    const current = get().users;
    const idx = current.findIndex(u => u.id === user.id);
    const users = idx === -1
      ? [...current, user]
      : current.map(u => u.id === user.id ? { ...u, ...user } : u);
    persist(users);
    set({ users });
  },

  // LWW merge para sync P2P — propaga perfiles de otros usuarios
  mergeUsers: (incoming) => {
    const current = get().users;
    const merged = [...current];
    for (const inc of incoming) {
      const idx = merged.findIndex(u => u.id === inc.id);
      if (idx === -1) {
        merged.push(inc);
      } else if (inc.updatedAt > merged[idx].updatedAt) {
        merged[idx] = inc;
      }
    }
    persist(merged);
    set({ users: merged });
  },

  hydrate: () => {
    const raw = storage.getString(KEY);
    const users = raw ? (JSON.parse(raw) as User[]) : [];
    set({ users });
  },
}));
