import { AppState } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { requestCaptchaToken } from './captchaBridge';
import { getRelayClient } from './relay';

/**
 * Sesión de Supabase SIEMPRE presente (T-147 D1/D2).
 *
 * Hasta acá el cliente se creaba con `persistSession: false`: la identidad la
 * manejaba la app, no Supabase, y `signInWithIdToken` sólo se llamaba una vez,
 * al tocar el botón de login. Al reabrir la app no había sesión y todo el
 * tráfico salía como `anon` — inclusive el de usuarios logueados. Cerrar el
 * buzón a `anon` (011b) cortaría el sync a todo el mundo, no sólo al invitado.
 *
 * La solución: la sesión se persiste, y si no hay ninguna se abre una
 * **anónima** (con Turnstile) antes de tocar el buzón. El modo invitado ES esa
 * sesión anónima (DEC-03) — no hay un camino separado.
 */

/** Adaptador de storage para `auth-js`: mismo cifrado at-rest que el resto de
 *  los datos sensibles (`SECURE_IDS`), un id de bucket propio (`'sbauth'`). */
const storage = createSecureStorage('sbauth');

export function supabaseAuthStorage(): {
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

export type SessionKind = 'identity' | 'anonymous' | 'none';

/** Tras un fallo (captcha o Auth), cuánto esperar antes de reintentar en vez de
 *  pedir un token nuevo en cada llamada — un servidor caído no debe convertirse
 *  en un captcha resuelto por segundo. */
export const SESSION_RETRY_MS = 120_000;

let ultimoFallo = 0;
let enCurso: Promise<SessionKind> | null = null;

/** Sólo tests. */
export function __resetRelaySession(): void {
  ultimoFallo = 0;
  enCurso = null;
}

async function abrirSesion(): Promise<SessionKind> {
  const supabase = getRelayClient();
  if (!supabase) return 'none';

  const captcha = await requestCaptchaToken();
  if (captcha.status === 'failed') {
    ultimoFallo = Date.now();
    return 'none';
  }

  const opciones = captcha.status === 'ok'
    ? { options: { captchaToken: captcha.token } }
    : undefined;

  const { data, error } = opciones
    ? await supabase.auth.signInAnonymously(opciones)
    : await supabase.auth.signInAnonymously();

  if (error || !data?.session) {
    ultimoFallo = Date.now();
    return 'none';
  }
  return 'anonymous';
}

/**
 * Garantiza que haya una sesión de Supabase antes de tocar el buzón.
 *
 * Single-flight: dos llamadas concurrentes comparten la misma promesa, así que
 * un `startRelay` y un poll que coinciden no abren dos sesiones anónimas.
 */
export function ensureRelaySession(): Promise<SessionKind> {
  if (enCurso) return enCurso;
  enCurso = hacerEnsure().finally(() => { enCurso = null; });
  return enCurso;
}

async function hacerEnsure(): Promise<SessionKind> {
  const supabase = getRelayClient();
  if (!supabase) return 'none';

  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.is_anonymous ? 'anonymous' : 'identity';

  if (ultimoFallo && Date.now() - ultimoFallo < SESSION_RETRY_MS) return 'none';

  return abrirSesion();
}

/**
 * Ata el auto-refresh del token al ciclo de vida de la app — patrón oficial de
 * Supabase para React Native: en background el refresco periódico no tiene
 * sentido (no hay red garantizada, y gasta batería) y `autoRefreshToken: true`
 * a secas no sabe distinguir primer plano de fondo.
 */
export function bindAuthRefreshToAppState(): () => void {
  const supabase = getRelayClient();
  const sub = AppState.addEventListener('change', estado => {
    if (!supabase) return;
    if (estado === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  return () => sub.remove();
}
