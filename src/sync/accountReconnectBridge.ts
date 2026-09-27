/**
 * Puente entre `relaySession` (que necesita un `id_token` fresco para
 * reconectar una cuenta, T-147 R3-1) y el host que en verdad sabe hablar con
 * los SDKs nativos de Google/Apple (`AccountReconnectHost`).
 *
 * Mismo patrón que `captchaBridge`: separado a propósito para que
 * `relaySession` sea lógica pura, testeable sin React ni SDKs nativos. El
 * host se registra al montar `_layout` y puede no existir todavía (arranque
 * muy temprano) — de ahí `not_available` en vez de una excepción.
 *
 * Dos modos:
 *  - `'silent'`: sin interacción del usuario — Google puede reconectar solo
 *    (`signInSilently`); Apple no tiene equivalente, así que siempre
 *    `not_available` en ese modo.
 *  - `'interactive'`: abre el flujo de login real del proveedor (botón
 *    «Reconectar»). Sirve para los dos.
 */

export type ReconnectOutcome =
  | { status: 'ok'; idToken: string }
  | { status: 'not_available' }
  | { status: 'failed' };

export type ReconnectMode = 'silent' | 'interactive';
export type ReconnectProvider = (provider: 'google' | 'apple', mode: ReconnectMode) => Promise<ReconnectOutcome>;

let provider: ReconnectProvider | null = null;

/** Llamado por `AccountReconnectHost` al montar/desmontar. */
export function registerReconnectProvider(p: ReconnectProvider | null): void {
  provider = p;
}

export async function requestReconnect(prov: 'google' | 'apple', mode: ReconnectMode): Promise<ReconnectOutcome> {
  if (!provider) return { status: 'not_available' };
  return provider(prov, mode);
}
