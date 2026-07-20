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

function readPersistedChoice(): ThemeChoice {
  const raw = storage.getString(KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

// MMKV es sincrónico: leemos la preferencia persistida ACA (al crear el store),
// no en un useEffect post-primer-render, para que el primer render ya use el
// tema real y no haya flash de 'auto' -> tema elegido.
// Exportada como factory (en vez de solo la instancia) para que los tests
// puedan crear una instancia fresca DESPUÉS de escribir en storage y así
// probar la lectura sincrónica en el initializer sin trucos de module cache.
export function createThemeStore() {
  return create<ThemeState>((set) => ({
    themeChoice: readPersistedChoice(),

    setThemeChoice: (choice) => {
      storage.set(KEY, choice);
      set({ themeChoice: choice });
    },

    // No-op: el estado inicial ya se hidrata sincrónicamente arriba. Se deja
    // como función (en vez de eliminarla) para no romper la llamada existente
    // en app/_layout.tsx.
    hydrate: () => {},
  }));
}

export const useThemeStore = createThemeStore();
