import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';
import { useUserStore } from './userStore';

const storage = createSecureStorage('auth');

const KEYS = {
  USER:   'current_user',
  IS_PRO: 'is_pro',
} as const;

interface AuthState {
  currentUser: User | null;
  isPro: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  setIsPro: (isPro: boolean) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  isPro: false,
  isLoading: true,

  setUser: (user) => {
    if (user) {
      storage.set(KEYS.USER, JSON.stringify(user));
      useUserStore.getState().addOrUpdateUser(user);
    } else {
      storage.delete(KEYS.USER);
    }
    set({ currentUser: user });
  },

  setIsPro: (isPro) => {
    storage.set(KEYS.IS_PRO, isPro);
    set({ isPro });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  signOut: () => {
    storage.delete(KEYS.USER);
    storage.delete(KEYS.IS_PRO);
    set({ currentUser: null, isPro: false });
  },

  hydrate: () => {
    const raw = storage.getString(KEYS.USER);
    const user = raw ? (JSON.parse(raw) as User) : null;
    const isPro = storage.getBoolean(KEYS.IS_PRO) ?? false;
    set({ currentUser: user, isPro, isLoading: false });
  },
}));
