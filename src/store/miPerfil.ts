import { useAuthStore } from './authStore';
import { useUserStore } from './userStore';
import { syncedNow } from '@/src/utils/syncedClock';
import type { User } from '@/src/types/models';

/**
 * Cambiar algo de MI perfil. El único lugar que lo hace.
 *
 * Existe porque cambiar el propio perfil son **tres** pasos y ninguno es
 * evidente, así que olvidarse de uno no rompe nada visible — simplemente el
 * cambio no llega a algún lado, y eso se descubre semanas después mirando otro
 * teléfono:
 *
 * 1. `authStore` — quién soy en esta sesión.
 * 2. `userStore` — la lista de contactos, que es lo que leen las pantallas **y**
 *    lo que arma el delta de sync. La re-hidratación que alinea los dos corre
 *    sólo al CAMBIAR de cuenta, no al editarse; sin este paso el dato viejo
 *    queda pegado hasta el próximo login.
 * 3. `anunciarMiTarjeta()` — a los contactos con los que no comparto ningún
 *    grupo, el delta de grupo NUNCA los alcanza: el único camino es el canal de
 *    contactos.
 *
 * Ya se pagó: el nombre hacía los tres y la foto sólo los dos primeros, así que
 * a un contacto sin grupo compartido la foto nueva le aparecía recién al
 * siguiente arranque de la app. La diferencia entre las dos funciones eran
 * cuatro líneas y nadie la iba a ver leyendo.
 *
 * Devuelve el usuario actualizado, o `null` si no hay sesión.
 */
export function actualizarMiPerfil(cambios: Partial<User>): User | null {
  const yo = useAuthStore.getState().currentUser;
  if (!yo) return null;

  const actualizado = { ...yo, ...cambios, updatedAt: syncedNow() };
  useAuthStore.getState().setUser(actualizado);
  useUserStore.getState().addOrUpdateUser(actualizado);
  void anunciar();

  return actualizado;
}

/**
 * El anuncio va por `require` perezoso: `relayEngine` arrastra el motor de sync
 * entero, y este módulo lo importan pantallas. Es la misma razón de T-054.
 */
function anunciar(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { anunciarMiTarjeta } = require('@/src/sync/relayEngine');
    void anunciarMiTarjeta();
  } catch {
    // Sin canal de contactos el perfil se guarda igual: el cambio llega por el
    // delta de grupo a quien comparta uno, y al resto en el próximo arranque.
  }
}
