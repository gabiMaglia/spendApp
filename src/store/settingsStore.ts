import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import { readScoped, readScopedBool, writeScoped, writeScopedBool } from './userScope';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/src/constants/currencies';

const storage = createStorage('settings');

const KEYS = {
  NOTIF_EXPENSES:  'notif_expenses',
  NOTIF_DELETIONS: 'notif_deletions',
  NOTIF_INVITES:   'notif_invites',
  DISPLAY_CURRENCY:'display_currency',
} as const;

/**
 * Moneda en la que el usuario ve sus totales. Los gastos siguen guardándose en
 * su moneda original; esto es sólo cómo se los muestra (ver `services/fx.ts`).
 * Default ARS, igual que el presupuesto personal.
 */
const DEFAULT_DISPLAY_CURRENCY: CurrencyCode = 'ARS';

function esMonedaSoportada(v: string | undefined): v is CurrencyCode {
  return !!v && SUPPORTED_CURRENCIES.some(c => c.code === v);
}

interface SettingsState {
  notifExpenses: boolean;
  notifDeletions: boolean;
  notifInvites: boolean;
  displayCurrency: CurrencyCode;

  setDisplayCurrency: (code: CurrencyCode) => void;
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
    displayCurrency: DEFAULT_DISPLAY_CURRENCY,

    setDisplayCurrency: (code) => {
      writeScoped(storage, KEYS.DISPLAY_CURRENCY, code);
      set({ displayCurrency: code });
    },

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
        // Un código guardado que ya no exista (data vieja, moneda retirada de
        // la lista) cae al default en vez de dejar la app pidiendo una tasa
        // para una moneda que no existe.
        displayCurrency: (() => {
          const guardado = readScoped(storage, KEYS.DISPLAY_CURRENCY);
          return esMonedaSoportada(guardado) ? guardado : DEFAULT_DISPLAY_CURRENCY;
        })(),
      });
    },
  }));
}

export const useSettingsStore = createSettingsStore();
