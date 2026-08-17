import { createSecureStorage } from '@/src/utils/secureStorage';
import { mergeAccountData, type MergeReport } from './mergeAccountData';
import { profileKey } from './authKeys';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';
import type { User } from '@/src/types/models';

/**
 * Los stores de datos que se fusionan cuando dos cuentas resultan ser la misma
 * persona. Todos guardan un array de registros con `id` + `updatedAt` bajo la
 * clave `data_v1` namespaceada por cuenta (ver `userScope`).
 *
 * Se declaran acá y no en `mergeAccountData` para que ese módulo quede sin
 * dependencias de stores y se pueda testear aislado.
 */
const MERGEABLE_STORES = ['groups', 'expenses', 'payments', 'personal', 'users', 'recurring', 'comments'] as const;

const DATA_KEY = 'data_v1';

/**
 * Fusiona TODOS los datos de `fromAccountId` dentro de `toAccountId`.
 * Unión con LWW por `updatedAt`; no borra el origen.
 */
export function mergeAccounts(fromAccountId: string, toAccountId: string): MergeReport {
  const stores = MERGEABLE_STORES.map(
    name => [createSecureStorage(name), DATA_KEY] as [ReturnType<typeof createSecureStorage>, string],
  );
  const report = mergeAccountData(stores, fromAccountId, toAccountId);
  mergeProfiles(fromAccountId, toAccountId);
  return report;
}

/**
 * El perfil (nombre y email de la cuenta) va aparte de los demás stores: no es
 * una lista bajo `data_v1` sino un objeto suelto bajo `profile::u:<id>`, así que
 * `mergeAccountData` no lo alcanza. Sin esto, enlazar dos cuentas descartaba el
 * nombre que el usuario había editado a mano en la cuenta absorbida.
 *
 * Semántica: gana el perfil DESTINO y el origen sólo completa lo que falte,
 * igual que `mergeProviderUser` — el criterio de siempre es no pisar un dato
 * que el usuario escribió.
 */
function mergeProfiles(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;

  const storage = createSecureStorage('auth');
  const read = (uid: string): User | null => {
    const raw = storage.getString(profileKey(uid));
    if (!raw) return null;
    try { return JSON.parse(raw) as User; } catch { return null; }
  };

  const source = read(fromAccountId);
  if (!source) return; // nada que aportar

  const target = read(toAccountId);
  const merged = mergeProviderUser(target, {
    id:           toAccountId,
    authProvider: target?.authProvider ?? source.authProvider,
    name:         source.name,
    email:        source.email,
    avatarUrl:    target?.avatarUrl ?? source.avatarUrl,
  });

  storage.set(profileKey(toAccountId), JSON.stringify(merged));
}

export { MERGEABLE_STORES };
