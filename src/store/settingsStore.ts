import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import { readScopedBool, writeScopedBool } from './userScope';

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
  hydrate: () => void;
}

// Default true: los toggles nacen encendidos para no apagarle las notificaciones
// a un usuario que nunca los tocó. Las preferencias se scopean por cuenta
// (readScopedBool/writeScopedBool) para que dos cuentas en el mismo device no
// las compartan; se (re)leen en hydrate() al cambiar de sesión.
export function createSettingsStore() {
  return create<SettingsState>((set) => ({
    notifExpenses:  true,
    notifDeletions: true,
    notifInvites:   true,

    setNotifExpenses: (value) => {
      writeScopedBool(storage, KEYS.NOTIF_EXPENSES, value);
      set({ notifExpenses: value });
    },
    setNotifDeletions: (value) => {
      writeScopedBool(storage, KEYS.NOTIF_DELETIONS, value);
      set({ notifDeletions: value });
    },
    setNotifInvites: (value) => {
      writeScopedBool(storage, KEYS.NOTIF_INVITES, value);
      set({ notifInvites: value });
    },

    hydrate: () => {
      set({
        notifExpenses:  readScopedBool(storage, KEYS.NOTIF_EXPENSES, true),
        notifDeletions: readScopedBool(storage, KEYS.NOTIF_DELETIONS, true),
        notifInvites:   readScopedBool(storage, KEYS.NOTIF_INVITES, true),
      });
    },
  }));
}

export const useSettingsStore = createSettingsStore();
