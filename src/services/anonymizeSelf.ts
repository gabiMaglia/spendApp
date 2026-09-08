import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * Reemplaza el propio perfil por uno anónimo, para que los peers dejen de ver
 * el nombre y la foto de quien borró la cuenta (T-074 D-1).
 *
 * **Los importes no se tocan.** Ningún gasto, pago ni comentario se modifica:
 * son la prueba de deudas de otras personas, y borrarlos les rompería las
 * cuentas a gente que no pidió nada (`docs/PRIVACIDAD.md`). Es lo mismo que
 * hacen WhatsApp y Splitwise — la persona desaparece de la presentación, sus
 * datos compartidos se quedan.
 *
 * Por qué es barato: los perfiles **ya viajan** dentro del sobre del grupo y se
 * aplican con `mergeByIdLWW` (`src/sync/useSyncQR.ts`, `src/store/lww.ts`), así
 * que alcanza con escribir el propio `User` con `updatedAt` nuevo. Cero
 * `CoreKind` nuevo, cero regla de merge, cero migración.
 *
 * **No usa `actualizarMiPerfil`** (`src/store/miPerfil.ts`) a propósito: esa
 * anuncia por el canal de contactos, y acá el aviso lo maneja el borrado, que
 * publica los grupos y después purga el buzón. Anunciar por dos caminos volvería
 * a llenar el buzón que se está por vaciar.
 *
 * No lanza nunca y es un no-op sin sesión: corre dentro de un borrado que no se
 * puede interrumpir a mitad de camino.
 */
export function anonymizeSelf(nombre: string): void {
  const yo = useAuthStore.getState().currentUser;
  if (!yo) return;

  // `avatar: null` y no `delete`: la ausencia del campo NO borra la foto — la
  // regla de T-056 (`src/store/userAvatar.ts`) conserva la que había, y con
  // razón. Quitársela pide el tombstone explícito que ese archivo dejó previsto.
  // `avatarUrl: undefined` explícito y no `delete`: `addOrUpdateUser` hace
  // `{ ...previo, ...entrante }`, así que una clave AUSENTE deja pasar la del
  // registro previo. La clave presente en undefined sí la pisa.
  const anonimo = {
    ...yo,
    name: nombre,
    avatar: null,
    avatarUrl: undefined,
    // La fecha, para que cada peer escriba el cartel en SU idioma; `name` queda
    // igual como respaldo para los que no actualizaron.
    deletedAt: syncedNow(),
    updatedAt: syncedNow(),
  };

  useAuthStore.getState().setUser(anonimo);
  useUserStore.getState().addOrUpdateUser(anonimo);
}
