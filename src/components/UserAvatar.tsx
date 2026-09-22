import React from 'react';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar, AvatarStack } from './Avatar';

/**
 * El avatar de una persona, resuelto por su id.
 *
 * Existe para no repetir en cada pantalla la misma búsqueda de nombre, color y
 * foto: había diez `<Avatar>` sueltos y agregar la foto habría significado
 * tocar los diez y acordarse de hacerlo en el próximo. Acá se resuelve una vez.
 *
 * Contempla al usuario actual: su foto vive en `authStore` y puede ser más
 * nueva que la copia de `userStore` justo después de cambiarla.
 */
export function UserAvatar({
  userId, name, size = 36, ring,
}: {
  userId: string;
  /** Nombre ya resuelto, si quien llama lo tiene a mano. Ahorra una búsqueda. */
  name?: string;
  size?: number;
  ring?: string;
}) {
  const yo       = useAuthStore(s => s.currentUser);
  // Selector FINO (PO 2026-09-22, rendimiento en gama baja): antes traía el
  // array `users` entero, así que editar CUALQUIER usuario re-renderizaba
  // TODOS los `UserAvatar` montados, no sólo el afectado. `addOrUpdateUser`
  // (`userStore.ts`) arma el array nuevo con `.map()` y conserva la
  // REFERENCIA de los usuarios no tocados — por eso este selector, que
  // devuelve sólo el usuario de este id, sólo dispara re-render cuando ESE
  // usuario puntual cambia.
  const guardado = useUserStore(s => s.users.find(u => u.id === userId));

  const esMio    = yo?.id === userId;
  const photo    = esMio ? (yo?.avatar ?? guardado?.avatar) : guardado?.avatar;

  return (
    <Avatar
      name={name ?? guardado?.name ?? (esMio ? yo?.name : undefined) ?? '?'}
      hue={hueForUser(userId)}
      photo={photo}
      size={size}
      ring={ring}
    />
  );
}

/**
 * La pila de avatares de un grupo de personas, resuelta por sus ids.
 *
 * Misma razón que `UserAvatar`, y el mismo defecto que vino a cerrar: quien
 * llamaba a `AvatarStack` armaba `{name, hue}` a mano y ahí se perdía la foto,
 * en silencio y sin que nada fallara. Pasando ids, no hay dónde olvidarse.
 */
export function UserAvatarStack({
  userIds, size = 28, max = 4, ring,
}: {
  userIds: readonly string[];
  size?: number;
  max?: number;
  ring?: string;
}) {
  const yo       = useAuthStore(s => s.currentUser);
  const usuarios = useUserStore(s => s.users);

  const people = userIds.map(id => {
    const guardado = usuarios.find(u => u.id === id);
    const esMio    = yo?.id === id;
    return {
      name:  guardado?.name ?? (esMio ? yo?.name : undefined) ?? '?',
      hue:   hueForUser(id),
      photo: esMio ? (yo?.avatar ?? guardado?.avatar) : guardado?.avatar,
    };
  });

  return <AvatarStack people={people} size={size} max={max} ring={ring} />;
}
