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
 * **Por qué era seguro:** la app no tenía forma de quitarse la foto —
 * `app/(tabs)/user.tsx` sólo la reemplaza por otra— así que no existía borrado
 * legítimo que esta regla pudiera romper. Este docblock decía: *«el día que
 * exista, se necesita un tombstone explícito (`avatar: null`), no la ausencia
 * del campo»*.
 *
 * **Ese día llegó con T-074** (borrado de cuenta): anonimizarse ES quitarse la
 * foto, y sin el tombstone la regla la resucitaba. Así que `avatar: null` pasa,
 * y la ausencia sigue conservando. La profecía estaba bien escrita.
 *
 * ⚠️ **Límite declarado:** un peer que todavía corre la versión anterior lee el
 * `null` como ausencia y **se queda con la foto vieja** hasta que actualice. Es
 * la misma «fase A» que este archivo ya describe: primero se propaga la regla,
 * después se puede confiar en ella.
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
  if (entrante.avatar === null) return entrante;   // tombstone: se la sacó a propósito
  if (!previo?.avatar || entrante.avatar) return entrante;
  return { ...entrante, avatar: previo.avatar };
}
