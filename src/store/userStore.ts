import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import type { User } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

const storage = createSecureStorage('users');
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
  writeScoped(storage, KEY, JSON.stringify(users));
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  users: [],

  getUserById: (id) => get().users.find(u => u.id === id),

  getUserName: (id) => get().users.find(u => u.id === id)?.name ?? 'Usuario',

  removeUser: (id) => {
    const users = get().users.map(u =>
      u.id === id ? { ...u, isDeleted: true, updatedAt: syncedNow() } : u,
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
    const merged = mergeByIdLWW(get().users, incoming);
    persist(merged);
    set({ users: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let users: User[] = [];
    try {
      users = raw ? (JSON.parse(raw) as User[]) : [];
    } catch {
      users = [];
    }
    set({ users });
  },
}));
