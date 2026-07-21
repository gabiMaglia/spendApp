import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';

const storage = createStorage('settings');

const KEYS = {
  NOTIF_EXPENSES:  'notif_expenses',
  NOTIF_DELETIONS: 'notif_deletions',
  NOTIF_INVITES:   'notif_invites',
} as const;

interface SettingsState {
  notifExpenses: boolean;
  notifDeletions: boolean;
  notifInvites: boolean;

  setNotifExpenses: (value: boolean) => void;
  setNotifDeletions: (value: boolean) => void;
  setNotifInvites: (value: boolean) => void;
}

// Default true: hasta ahora los toggles nacían en `true` (useState local) y no
// queremos que, al migrar a MMKV, un usuario existente vea sus notificaciones
// "apagadas" de golpe solo porque nunca hubo un valor persistido.
function readPersistedFlag(key: string): boolean {
  const raw = storage.getBoolean(key);
  return raw ?? true;
}

// MMKV es sincrónico: leemos los 3 flags ACA (al crear el store), igual que
// themeStore, para que el primer render ya refleje el valor persistido sin
// flash. Exportado como factory para permitir tests con una instancia fresca
// tras escribir en storage (mismo patrón que createThemeStore).
export function createSettingsStore() {
  return create<SettingsState>((set) => ({
    notifExpenses:  readPersistedFlag(KEYS.NOTIF_EXPENSES),
    notifDeletions: readPersistedFlag(KEYS.NOTIF_DELETIONS),
    notifInvites:   readPersistedFlag(KEYS.NOTIF_INVITES),

    setNotifExpenses: (value) => {
      storage.set(KEYS.NOTIF_EXPENSES, value);
      set({ notifExpenses: value });
    },
    setNotifDeletions: (value) => {
      storage.set(KEYS.NOTIF_DELETIONS, value);
      set({ notifDeletions: value });
    },
    setNotifInvites: (value) => {
      storage.set(KEYS.NOTIF_INVITES, value);
      set({ notifInvites: value });
    },
  }));
}

export const useSettingsStore = createSettingsStore();
