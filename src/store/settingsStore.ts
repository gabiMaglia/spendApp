import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import { readScoped, readScopedBool, writeScoped, writeScopedBool } from './userScope';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/src/constants/currencies';
import { esDispositivoDeGamaBaja } from '@/src/utils/deviceTier';
import { SKIN_INICIAL, esSkinId, type SkinId } from '@/src/skins/registry';

const storage = createStorage('settings');

const KEYS = {
  NOTIF_EXPENSES:  'notif_expenses',
  NOTIF_DELETIONS: 'notif_deletions',
  NOTIF_INVITES:   'notif_invites',
  NOTIF_SETTLEMENTS:'notif_settlements',
  DISPLAY_CURRENCY:'display_currency',
  REDUCE_ANIMATIONS:'reduce_animations',
  SKIN: 'skin',
  ACTIVITY_SEEN_UNTIL: 'activity_seen_until',
} as const;

/**
 * Moneda en la que el usuario ve sus totales. Los gastos siguen guardándose en
 * su moneda original; esto es sólo cómo se los muestra (ver `services/fx.ts`).
 * Default ARS, igual que el presupuesto personal.
 */
export const DEFAULT_DISPLAY_CURRENCY: CurrencyCode = 'ARS';

/**
 * Exportada (no sólo usada acá): `backup.ts` la reusa para validar
 * `settings.displayCurrency` al restaurar (T-213 · QA defecto 1) — mismo
 * patrón que `skin` con `esSkinId`/`SKIN_INICIAL` de `skins/registry.ts`,
 * fuente única en vez de reimplementar el chequeo en el backup.
 */
export function esMonedaSoportada(v: string | undefined): v is CurrencyCode {
  return !!v && SUPPORTED_CURRENCIES.some(c => c.code === v);
}

interface SettingsState {
  notifExpenses: boolean;
  notifDeletions: boolean;
  notifInvites: boolean;
  notifSettlements: boolean;
  displayCurrency: CurrencyCode;
  /**
   * "Reducir animaciones" (PO 2026-09-22): apaga el odómetro de `MontoRodante`
   * y la entrada/salida animada de los sheets. Default = heurístico de
   * `esDispositivoDeGamaBaja()` — sólo hasta que el usuario toque el toggle
   * en "Yo": a partir de ahí gana siempre su elección guardada, sin importar
   * lo que diga el heurístico.
   */
  reduceAnimations: boolean;

  /** Skin visual elegido en Yo (PO 2026-09-25). Default = `SKIN_INICIAL` (Aero, PO 2026-09-29). */
  skin: SkinId;
  setSkin: (id: SkinId) => void;

  /** Última vez que salí de Actividad (ms). Define el «N sin ver» (PO 2026-09-29). */
  actividadVistaHasta: number;
  setActividadVistaHasta: (ms: number) => void;

  setDisplayCurrency: (code: CurrencyCode) => void;
  setNotifExpenses: (value: boolean) => void;
  setNotifDeletions: (value: boolean) => void;
  setNotifInvites: (value: boolean) => void;
  setNotifSettlements: (value: boolean) => void;
  setReduceAnimations: (value: boolean) => void;
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
    notifSettlements: true,
    displayCurrency: DEFAULT_DISPLAY_CURRENCY,
    reduceAnimations: esDispositivoDeGamaBaja(),
    skin: SKIN_INICIAL,
    actividadVistaHasta: 0,

    setActividadVistaHasta: (ms) => {
      writeScoped(storage, KEYS.ACTIVITY_SEEN_UNTIL, String(ms));
      set({ actividadVistaHasta: ms });
    },

    setSkin: (id) => {
      writeScoped(storage, KEYS.SKIN, id);
      set({ skin: id });
    },

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
    setNotifSettlements: (value) => {
      writeScopedBool(storage, KEYS.NOTIF_SETTLEMENTS, value);
      set({ notifSettlements: value });
    },
    setReduceAnimations: (value) => {
      writeScopedBool(storage, KEYS.REDUCE_ANIMATIONS, value);
      set({ reduceAnimations: value });
    },

    hydrate: () => {
      set({
        notifExpenses:  readScopedBool(storage, KEYS.NOTIF_EXPENSES, true),
        notifDeletions: readScopedBool(storage, KEYS.NOTIF_DELETIONS, true),
        notifInvites:   readScopedBool(storage, KEYS.NOTIF_INVITES, true),
        notifSettlements: readScopedBool(storage, KEYS.NOTIF_SETTLEMENTS, true),
        // Default = heurístico de gama baja, no `false`: así un equipo viejo
        // arranca con las animaciones ya apagadas sin que nadie tenga que
        // encontrar el toggle primero.
        reduceAnimations: readScopedBool(storage, KEYS.REDUCE_ANIMATIONS, esDispositivoDeGamaBaja()),
        // Un código guardado que ya no exista (data vieja, moneda retirada de
        // la lista) cae al default en vez de dejar la app pidiendo una tasa
        // para una moneda que no existe.
        displayCurrency: (() => {
          const guardado = readScoped(storage, KEYS.DISPLAY_CURRENCY);
          return esMonedaSoportada(guardado) ? guardado : DEFAULT_DISPLAY_CURRENCY;
        })(),
        // Un skin guardado que ya no exista (retirado, data vieja) cae al
        // skin inicial en vez de dejar la app pidiendo un skin inexistente.
        skin: (() => {
          const guardado = readScoped(storage, KEYS.SKIN);
          return esSkinId(guardado) ? guardado : SKIN_INICIAL;
        })(),
        actividadVistaHasta: Number(readScoped(storage, KEYS.ACTIVITY_SEEN_UNTIL)) || 0,
      });
    },
  }));
}

export const useSettingsStore = createSettingsStore();
