import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const storage = createSecureStorage('auth');

const KEYS = {
  USER:   'current_user',
  IS_PRO: 'is_pro',
} as const;

// isPro es por-cuenta (la suscripción es de un usuario). La sesión (current_user)
// es global (puntero a la cuenta activa); isPro se scopea por el id del usuario.
function isProKey(uid: string): string {
  return `${KEYS.IS_PRO}::u:${uid}`;
}

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

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  isPro: false,
  isLoading: true,

  // Setea la cuenta activa. La (re)hidratación de los stores por-cuenta la
  // dispara el coordinador de sesión (src/store/session.ts) al observar este
  // cambio — por eso acá NO tocamos userStore (evita ciclos y orden incorrecto).
  setUser: (user) => {
    if (user) {
      storage.set(KEYS.USER, JSON.stringify(user));
    } else {
      storage.delete(KEYS.USER);
    }
    const isPro = user ? (storage.getBoolean(isProKey(user.id)) ?? false) : false;
    set({ currentUser: user, isPro });
  },

  setIsPro: (isPro) => {
    const uid = get().currentUser?.id;
    if (uid) storage.set(isProKey(uid), isPro);
    set({ isPro });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  signOut: () => {
    storage.delete(KEYS.USER);
    // El isPro scopeado del usuario NO se borra: queda para cuando vuelva a entrar.
    set({ currentUser: null, isPro: false });
  },

  hydrate: () => {
    const raw = storage.getString(KEYS.USER);
    const user = raw ? (JSON.parse(raw) as User) : null;
    const isPro = user ? (storage.getBoolean(isProKey(user.id)) ?? false) : false;
    set({ currentUser: user, isPro, isLoading: false });
  },
}));
