import { mergeUsersLWW } from './mergeUsersLWW';
import { preservarAvatar } from './userAvatar';
import type { User } from '@/src/types/models';

/**
 * Merge puro de perfiles: LWW con tope de reloj, más la preservación del avatar.
 *
 * Vive en su propio módulo (T-149, auditoría de los 7 stores en la ronda 1 del
 * verificador) para que `accountLink.mergeAccounts` la reutilice sin depender
 * de `userStore.ts` (que importa `i18n`, innecesario para fusionar). Mismo
 * defecto que D1 pero para el avatar: `mergeUsersLWW` desnudo reemplaza el
 * registro entero, así que un perfil entrante sin `avatar` y con `updatedAt`
 * mayor se lleva puesta la foto local. `userStore.mergeUsers` importa esta
 * MISMA función; no hay una segunda copia en ningún lado.
 */
export function mergeUsersPure(current: User[], incoming: User[], now: number): User[] {
  const previos = new Map(current.map(u => [u.id, u]));
  return mergeUsersLWW(current, incoming, now).map(u => preservarAvatar(previos.get(u.id), u));
}
