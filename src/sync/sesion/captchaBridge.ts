/**
 * Puente entre `relaySession` (que necesita un token de captcha para poder
 * abrir sesión anónima, T-147) y el widget visual que en verdad sabe hablar
 * con Turnstile (`TurnstileWidget`, montado inline sólo en
 * `app/auth/verify.tsx` — la única pantalla donde el captcha puede aparecer).
 *
 * Separado a propósito: `relaySession` es lógica pura, testeable sin React ni
 * WebView. El widget se registra en tiempo de ejecución (al montar la
 * pantalla de verificación) y puede no existir todavía o dejar de existir
 * (test, desmontaje, o simplemente que esa pantalla no esté activa) — de ahí
 * `not_required`/`no_host` en vez de una excepción.
 */

export type CaptchaOutcome =
  | { status: 'not_required' }                 // EXPO_PUBLIC_TURNSTILE_SITEKEY vacía: nada que resolver
  | { status: 'ok'; token: string }
  | { status: 'failed'; reason: 'no_host' | 'timeout' | 'error' | 'dismissed' };

export type CaptchaProvider = () => Promise<CaptchaOutcome>;

let provider: CaptchaProvider | null = null;

/** Llamado por `TurnstileWidget` al montar/desmontar. `null` = ya no hay a quién pedirle. */
export function registerCaptchaProvider(p: CaptchaProvider | null): void {
  provider = p;
}

/**
 * Pide un token de Turnstile.
 *
 * Sin site key configurada, no hace falta captcha: la app corre sin Cloudflare
 * (dev local, o un ambiente sin la variable) y `signInAnonymously` se llama sin
 * `captchaToken` — Supabase decide si igual lo exige.
 */
export async function requestCaptchaToken(): Promise<CaptchaOutcome> {
  if (!process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY) return { status: 'not_required' };
  if (!provider) return { status: 'failed', reason: 'no_host' };
  return provider();
}

/**
 * T-147 (fix "no se pudo confirmar tu acceso", causa raíz confirmada con
 * systematic-debugging): `relaySession` tiene un tope de tiempo para la
 * parte de RED (`SESSION_TIMEOUT_MS`), pero la espera del captcha
 * INTERACTIVO —Cloudflare pidió intervención humana— la decide la persona,
 * sin tope (el propio widget ya tiene su aviso "atascado" + Reintentar). El
 * widget avisa acá cuándo entra y sale de ese modo; `relaySession` se
 * suscribe para pausar su reloj de red mientras tanto.
 */
export type InteractiveListener = (activo: boolean) => void;

let interactiveListeners: InteractiveListener[] = [];

/** Llamado únicamente por el widget de Turnstile. */
export function setCaptchaInteractive(activo: boolean): void {
  interactiveListeners.forEach(l => l(activo));
}

/** Devuelve la función para desuscribirse. */
export function onCaptchaInteractiveChange(listener: InteractiveListener): () => void {
  interactiveListeners.push(listener);
  return () => { interactiveListeners = interactiveListeners.filter(l => l !== listener); };
}
