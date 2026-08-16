import { createSecureStorage } from '@/src/utils/secureStorage';
import { mergeAccountData, type MergeReport } from './mergeAccountData';

/**
 * Los stores de datos que se fusionan cuando dos cuentas resultan ser la misma
 * persona. Todos guardan un array de registros con `id` + `updatedAt` bajo la
 * clave `data_v1` namespaceada por cuenta (ver `userScope`).
 *
 * Se declaran acá y no en `mergeAccountData` para que ese módulo quede sin
 * dependencias de stores y se pueda testear aislado.
 */
const MERGEABLE_STORES = ['groups', 'expenses', 'payments', 'personal', 'users'] as const;

const DATA_KEY = 'data_v1';

/**
 * Fusiona TODOS los datos de `fromAccountId` dentro de `toAccountId`.
 * Unión con LWW por `updatedAt`; no borra el origen.
 */
export function mergeAccounts(fromAccountId: string, toAccountId: string): MergeReport {
  const stores = MERGEABLE_STORES.map(
    name => [createSecureStorage(name), DATA_KEY] as [ReturnType<typeof createSecureStorage>, string],
  );
  return mergeAccountData(stores, fromAccountId, toAccountId);
}

export { MERGEABLE_STORES };
