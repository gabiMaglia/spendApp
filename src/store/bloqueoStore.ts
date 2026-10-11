import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';

/**
 * Personas bloqueadas (T-235, Apple 1.2). Preferencia LOCAL de esta cuenta:
 * oculta sus comentarios y su foto en este dispositivo. **Nunca viaja por el
 * sync** — bloquear a alguien no le avisa ni cambia lo que ve el resto del grupo.
 */
// Bucket `comments` con su propia clave: el bloqueo existe por los comentarios.
// Al enlazar cuentas se UNE (`mergeBloqueos` en accountLink).
const storage = createSecureStorage('comments');
const KEY = 'bloqueados_v1';

interface BloqueoState {
  bloqueados: string[];
  estaBloqueado: (userId: string) => boolean;
  bloquear: (userId: string) => void;
  desbloquear: (userId: string) => void;
  hydrate: () => void;
  /** Reemplazo total desde un backup propio (T-213/T-235). Sólo lo llama `backup.ts`. */
  restore: (ids: string[]) => void;
}

function persistir(ids: string[]) {
  writeScoped(storage, KEY, JSON.stringify(ids));
}

export const useBloqueoStore = create<BloqueoState>((set, get) => ({
  bloqueados: [],

  estaBloqueado: (userId) => get().bloqueados.includes(userId),

  bloquear: (userId) => {
    if (!userId || get().bloqueados.includes(userId)) return;
    const bloqueados = [...get().bloqueados, userId];
    persistir(bloqueados);
    set({ bloqueados });
  },

  desbloquear: (userId) => {
    const bloqueados = get().bloqueados.filter(id => id !== userId);
    persistir(bloqueados);
    set({ bloqueados });
  },

  restore: (ids) => {
    const bloqueados = [...new Set(ids.filter(Boolean))];
    persistir(bloqueados);
    set({ bloqueados });
  },

  hydrate: () => {
    let bloqueados: string[] = [];
    try {
      const raw = readScoped(storage, KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) bloqueados = parsed.filter((x): x is string => typeof x === 'string');
    } catch { /* dato corrupto: arranca vacío */ }
    set({ bloqueados });
  },
}));
