import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * Cliente de Supabase del DIRECTORIO de claves (ADR-004) — T-147,
 * SIMPLIFICACIÓN aprobada por el PO (2026-09-27).
 *
 * El buzón (ADR-003) es un buzón TONTO que no necesita saber de qué cuenta
 * es cada sobre — el acceso es por topic, el contenido va cifrado E2E, y la
 * cuota/anti-abuso alcanza con "un aparato real" (sesión anónima + captcha,
 * ver `relay.ts`/`relaySession.ts`). El directorio de claves es la ÚNICA
 * pieza que sí necesita probar de qué CUENTA es una clave (`registerDeviceKey`
 * / `owns_account`), y para eso usa el `id_token` de Google/Apple que el
 * login YA tiene — sin pantalla ni consentimiento extra.
 *
 * Antes de T-147 (ronda del Arbitraje P-2, descartada por esta
 * simplificación) los dos usos compartían el mismo cliente de Supabase — lo
 * que obligaba a decidir, en cada request, "con qué JWT sale esto" y abría la
 * familia de defectos que el PO cerró de raíz: **el buzón NUNCA debe llevar
 * el JWT de una cuenta.** La forma más simple de garantizarlo es que ni
 * siquiera EXISTA un cliente que pueda hacer las dos cosas: éste sólo sirve
 * para el directorio, `relay.getRelayClient()` sólo para el buzón, y cada uno
 * tiene su storage cifrado propio (bucket `'sbdir'` acá, `'sbauth'` allá) —
 * no hay ninguna sesión que uno pueda "heredar" del otro.
 *
 * `persistSession: false`: como antes de T-147, el login llama a
 * `signInWithIdToken` puntualmente y usa esa sesión de inmediato para
 * `registerDeviceKey` — no hace falta que sobreviva a cerrar la app (leer el
 * directorio, `account_keys`/`device_keys`, no exige sesión: la policy de
 * SELECT es abierta).
 */

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const storage = createSecureStorage('sbdir');

export function directoryAuthStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  return {
    getItem: k => storage.getString(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: k => storage.delete(k),
  };
}

let client: SupabaseClient | null = null;

export function getDirectoryClient(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  if (!client) {
    client = createClient(URL, ANON, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: directoryAuthStorage(),
      },
    });
  }
  return client;
}

/** Sólo tests: fuerza a que la próxima `getDirectoryClient()` cree uno nuevo. */
export function __resetDirectoryClient(): void {
  client = null;
}
