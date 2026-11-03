import type { User } from '@/src/types/models';
import { applyBackup, type BackupFile } from '@/src/services/backup';
import { esYo } from '@/src/store/identityAlias';
import { useAuthStore, recordGuestAccount } from '@/src/store/authStore';
import { useEntryGateStore } from '@/src/store/entryGateStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { barrerScope } from '@/src/store/accountLink';

/**
 * T-249 · un invitado recién creado restaura SU PROPIO respaldo.
 *
 * El invitado recibe un uuid nuevo en cada entrada, así que en un teléfono
 * nuevo su respaldo traía un `ownerId` que `esYo` no reconoce: se trataba como
 * ajeno (sin claves de grupo, sin contactos, sin preferencias). Si la sesión es
 * un invitado VACÍO y el dueño del archivo era también un invitado, lo más
 * probable es que sea la misma persona: se le ofrece seguir con esa identidad.
 *
 * «Dueño era invitado» se sabe por el registro del dueño dentro de
 * `backup.users` (`authProvider: 'guest'`): `rehydrateForActiveUser` siempre
 * agrega al usuario de sesión a `userStore`, así que está en cualquier
 * respaldo v2+. Si no está, no hay forma fiable y NO se ofrece.
 */
export function respaldoDeInvitadoAdoptable(backup: BackupFile): User | null {
  const yo = useAuthStore.getState().currentUser;
  if (!yo || yo.authProvider !== 'guest') return null;
  if (backup.ownerId === undefined || esYo(backup.ownerId)) return null;
  if (tieneDatosPropios()) return null;

  const dueno = backup.users.find(u => u.id === backup.ownerId);
  if (!dueno || dueno.authProvider !== 'guest' || dueno.isDeleted) return null;
  return dueno;
}

function tieneDatosPropios(): boolean {
  return useGroupStore.getState().groups.some(g => !g.isDeleted)
    || useExpenseStore.getState().expenses.some(e => !e.isDeleted)
    || usePaymentStore.getState().payments.some(p => !p.isDeleted);
}

/**
 * La sesión adopta la identidad del respaldo y el archivo se aplica como PROPIO.
 *
 * El orden es el de cualquier cambio de cuenta: se pide la verificación del
 * buzón ANTES de `setUser` (`AuthGuard` la lee en el mismo tick), y el cambio de
 * `currentUser.id` dispara solo `reiniciarSyncPorCambioDeCuenta` — corta el
 * motor, descarta la sesión anónima vieja y la próxima abre otra con
 * `app_id` = el id adoptado (T-238). Recién con el id ya cambiado corre
 * `applyBackup`, para que `esYo(ownerId)` sea verdadero y entren claves,
 * contactos, alias y preferencias.
 */
export function adoptarRespaldoDeInvitado(backup: BackupFile, dueno: User): void {
  const descartado = useAuthStore.getState().currentUser?.id;

  recordGuestAccount(dueno.id);
  useEntryGateStore.getState().pedirVerificacion();
  useAuthStore.getState().setUser(dueno);

  // Todo lo que el invitado descartado alcanzó a escribir en su scope (su propio
  // registro, el perfil, un secreto de contacto): sin dueño, quedaría para siempre.
  if (descartado && descartado !== dueno.id) barrerScope(descartado);

  applyBackup(backup);
}
