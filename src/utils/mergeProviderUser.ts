import type { User } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * Perfil tal como lo devuelve un proveedor OAuth. Todos los campos de datos son
 * opcionales A PROPÓSITO: Apple manda `fullName` y `email` SOLO en el primer
 * login de cada Apple ID; en los siguientes llegan `null`.
 */
export type ProviderProfile = {
  id: string;
  authProvider: User['authProvider'];
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

export const FALLBACK_USER_NAME = 'Usuario';

function clean(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Combina el perfil guardado de una cuenta con lo que acaba de mandar el proveedor.
 *
 * **Regla: lo guardado localmente GANA; el proveedor sólo completa lo que falta.**
 *
 * Es deliberado y no es simetría caprichosa:
 *  - Apple no reenvía nombre ni email después del primer login.
 *  - El usuario puede haber editado su nombre a mano en "Yo".
 * En ambos casos, dejar ganar al proveedor destruye un dato que no se puede recuperar.
 *
 * Excepción: si lo guardado es el nombre de relleno (`FALLBACK_USER_NAME`), no es un
 * dato real y el proveedor puede mejorarlo.
 * `avatarUrl` sí deja ganar al proveedor: no es editable por el usuario en la app.
 */
export function mergeProviderUser(
  stored: User | null | undefined,
  incoming: ProviderProfile,
  now: number = syncedNow(),
): User {
  const prev = stored && stored.id === incoming.id ? stored : null;

  const storedName = clean(prev?.name);
  const usableStoredName = storedName === FALLBACK_USER_NAME ? undefined : storedName;

  return {
    id:           incoming.id,
    name:         usableStoredName ?? clean(incoming.name) ?? FALLBACK_USER_NAME,
    email:        clean(prev?.email) ?? clean(incoming.email) ?? '',
    avatarUrl:    clean(incoming.avatarUrl) ?? prev?.avatarUrl,
    username:     prev?.username,
    authProvider: incoming.authProvider,
    createdAt:    prev?.createdAt ?? now,
    updatedAt:    now,
    isDeleted:    false,
  };
}
