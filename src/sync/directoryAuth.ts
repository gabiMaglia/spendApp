import { getRelayClient } from './relay';
import { trackIdentitySignIn } from './relaySession';

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
    // T-147 (D2): mientras esto está en vuelo, `ensureRelaySession` lo espera
    // antes de decidir abrir una sesión anónima — sin esto, una anónima que
    // termina de escribirse DESPUÉS de este login pisa la sesión de cuenta.
    const { error } = await trackIdentitySignIn(supabase.auth.signInWithIdToken({ provider, token: idToken }));
    if (error) return { ok: false, reason: 'rejected', detail: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'rejected', detail: String(e) };
  }
}

/**
 * Cierra la sesión del directorio. Se llama al desloguearse de la app.
 *
 * **`scope: 'local'` (T-147 H2).** El default de `signOut()` es
 * `scope: 'global'`: revoca el refresh token en TODOS los dispositivos. Con la
 * sesión persistida (D1) esto pasa de ser un detalle a doler de verdad —
 * desloguearse en un teléfono cerraría también la sesión de Google del otro.
 * `local` sólo tira la sesión de este aparato; la próxima operación del buzón
 * abre una anónima nueva (I5, ninguna pérdida de datos).
 */
export async function signOutOfDirectory(): Promise<void> {
  const supabase = getRelayClient();
  if (!supabase) return;
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* no bloquea el logout local */ }
}
