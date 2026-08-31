import type { User } from '@/src/types/models';

/**
 * **La foto de perfil sólo la reemplaza su dueño, nunca la borra un tercero**
 * (T-056).
 *
 * `mergeByIdLWW` reemplaza el registro ENTERO, así que un `User` que llega sin
 * foto se lleva puesta la que había. Y en empate de `updatedAt` el desempate es
 * por `canonical` mayor: la clave `"avatar"` ordena antes que `"createdAt"`, con
 * lo cual el registro **sin** foto produce el canónico mayor y gana justo el que
 * borra.
 *
 * No es teórico. `contactChannel` escribe la tarjeta recibida con `updatedAt`
 * nuevo y `avatar: msg.avatar`: cuando la tarjeta viene sin foto, ese `undefined`
 * entra por el spread de `addOrUpdateUser`, borra la foto local y después se
 * republica al grupo entero con timestamp nuevo. Una copia sin foto contamina a
 * todos.
 *
 * **Por qué es seguro y no pierde nada:** la app no tiene forma de quitarse la
 * foto — `app/(tabs)/user.tsx` sólo la reemplaza por otra. No existe borrado
 * legítimo que esta regla pueda romper. El día que exista, se necesita un
 * tombstone explícito (`avatar: null`), no la ausencia del campo.
 *
 * **Y converge:** si A tiene la foto y B no, A la conserva y B la adopta. Es
 * estrictamente MÁS convergente que el LWW pelado, que dejaba el resultado a
 * merced de quién publicó último.
 *
 * Es además la **fase A** de no reenviar avatares ajenos en cada sobre: mientras
 * haya dispositivos sin esta regla, un sobre con la foto quitada les borraría la
 * que tienen. Primero se propaga la defensa, después se puede aligerar el sobre.
 */
export function preservarAvatar(previo: User | undefined, entrante: User): User {
  if (!previo?.avatar || entrante.avatar) return entrante;
  return { ...entrante, avatar: previo.avatar };
}
