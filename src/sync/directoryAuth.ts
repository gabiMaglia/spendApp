import { getRelayClient } from './relay';

/**
 * Sesión contra Supabase Auth, usada SÓLO para poder escribir en el directorio
 * de claves (ADR-004).
 *
 * No decide quién entra a la app: eso lo sigue resolviendo el login de siempre,
 * en el dispositivo. Acá lo único que se busca es que el servidor pueda probar
 * "esta cuenta es de quien está pidiendo registrar la clave" — cosa que el
 * cliente no puede probar solo.
 *
 * Se le pasa el mismo `id_token` que Google o Apple ya devuelven al loguearse:
 * no hay una segunda pantalla ni un segundo consentimiento para el usuario.
 *
 * Todo lo de acá es **best effort**: si falla, la app funciona exactamente como
 * antes de que este archivo existiera.
 */

export type DirectorySignIn =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'no_token' | 'rejected'; detail?: string };

export async function signIntoDirectory(
  provider: 'google' | 'apple',
  idToken: string | null | undefined,
): Promise<DirectorySignIn> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // Sin `webClientId` configurado, el SDK de Google no devuelve `idToken`. Es
  // el fallo más probable de todos y conviene distinguirlo de un rechazo del
  // servidor: uno se arregla en el .env, el otro en el panel de Supabase.
  if (!idToken) return { ok: false, reason: 'no_token' };

  try {
    const { error } = await supabase.auth.signInWithIdToken({ provider, token: idToken });
    if (error) return { ok: false, reason: 'rejected', detail: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'rejected', detail: String(e) };
  }
}

/** Cierra la sesión del directorio. Se llama al desloguearse de la app. */
export async function signOutOfDirectory(): Promise<void> {
  const supabase = getRelayClient();
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch { /* no bloquea el logout local */ }
}
