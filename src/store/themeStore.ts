import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';

const storage = createStorage('theme');

const KEY = 'theme_choice';

export type ThemeChoice = 'auto' | 'light' | 'dark';

interface ThemeState {
  themeChoice: ThemeChoice;
  setThemeChoice: (choice: ThemeChoice) => void;
  hydrate: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeChoice: 'auto',

  setThemeChoice: (choice) => {
    storage.set(KEY, choice);
    set({ themeChoice: choice });
  },

  hydrate: () => {
    const raw = storage.getString(KEY);
    const choice: ThemeChoice = raw === 'light' || raw === 'dark' ? raw : 'auto';
    set({ themeChoice: choice });
  },
}));
