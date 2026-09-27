import { getDirectoryClient } from './directoryClient';
import { createSerialQueue } from '@/src/utils/serialQueue';

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
 *
 * **T-147 (SIMPLIFICACIÓN 2026-09-27):** este login corre en su PROPIO
 * cliente de Supabase (`directoryClient.ts`), separado del que usa el buzón
 * (`relay.ts`). Ya no hace falta compartir una cola con `relaySession` — las
 * dos sesiones viven en storages distintos y no pueden pisarse entre sí. Lo
 * que SÍ sigue haciendo falta es serializar el login y el logout DEL
 * DIRECTORIO entre sí (un logout lento no puede terminar después de que el
 * login siguiente ya escribió su sesión) — de ahí la cola propia.
 */
const cola = createSerialQueue();

export type DirectorySignIn =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'no_token' | 'rejected'; detail?: string };

export async function signIntoDirectory(
  provider: 'google' | 'apple',
  idToken: string | null | undefined,
): Promise<DirectorySignIn> {
  const supabase = getDirectoryClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // Sin `webClientId` configurado, el SDK de Google no devuelve `idToken`. Es
  // el fallo más probable de todos y conviene distinguirlo de un rechazo del
  // servidor: uno se arregla en el .env, el otro en el panel de Supabase.
  if (!idToken) return { ok: false, reason: 'no_token' };

  return cola.run(async () => {
    try {
      const { error } = await supabase.auth.signInWithIdToken({ provider, token: idToken });
      if (error) return { ok: false, reason: 'rejected', detail: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'rejected', detail: String(e) };
    }
  });
}

/**
 * Cierra la sesión del directorio. Se llama al desloguearse de la app.
 *
 * `scope: 'local'`: el default de `signOut()` es `scope: 'global'` y
 * revocaría el refresh token en TODOS los dispositivos — con la sesión
 * persistida esto doleria de verdad, pero acá ni siquiera aplica porque el
 * cliente del directorio NO persiste sesión (`persistSession: false`,
 * `directoryClient.ts`): igual se pide `'local'` por las dudas de que auth-js
 * tenga algo en memoria para esta instancia.
 */
export async function signOutOfDirectory(): Promise<void> {
  const supabase = getDirectoryClient();
  if (!supabase) return;

  await cola.run(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Sin sesión persistida no hay nada que forzar: el próximo login del
      // directorio abre una sesión nueva sin importar cómo terminó ésta.
    }
  });
}
