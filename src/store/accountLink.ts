import { createSecureStorage } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
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
/**
 * Stores que guardan su lista bajo la clave `data_v1`.
 *
 * `personal` NO está acá: persiste bajo `entries_v1` (+ `budget_v1`), no bajo
 * `data_v1`. Estuvo en esta lista y era peor que no estar — `readList` leía una
 * clave inexistente, devolvía `[]` y reportaba la fusión como exitosa con cero
 * registros, así que los movimientos personales y el presupuesto de la cuenta
 * absorbida desaparecían en silencio. Se fusiona aparte, en `mergePersonal()`.
 */
const MERGEABLE_STORES = ['groups', 'expenses', 'payments', 'users', 'recurring', 'comments'] as const;

const DATA_KEY = 'data_v1';
const PERSONAL_ENTRIES_KEY = 'entries_v1';
const PERSONAL_BUDGET_KEY  = 'budget_v1';

/**
 * Fusiona TODOS los datos de `fromAccountId` dentro de `toAccountId`.
 * Unión con LWW por `updatedAt`; no borra el origen.
 */
export function mergeAccounts(fromAccountId: string, toAccountId: string): MergeReport {
  const stores = MERGEABLE_STORES.map(
    name => [createSecureStorage(name), DATA_KEY] as [ReturnType<typeof createSecureStorage>, string],
  );
  const report = mergeAccountData(stores, fromAccountId, toAccountId);
  mergePersonal(fromAccountId, toAccountId, report);
  mergeProfiles(fromAccountId, toAccountId);
  mergeSettings(fromAccountId, toAccountId);
  return report;
}

/** Preferencias por cuenta (toggles de notificación). */
const SETTINGS_KEYS = ['notif_expenses', 'notif_deletions', 'notif_invites'] as const;

/**
 * Las preferencias son booleanos sueltos, no una lista, así que tampoco pasan
 * por `mergeAccountData`. Sin esto los toggles volvían al default al enlazar.
 * Gana el destino: sólo se adopta la preferencia del origen si el destino nunca
 * la configuró (no se pisa una elección explícita del usuario).
 */
function mergeSettings(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;
  const storage = createStorage('settings');

  for (const key of SETTINGS_KEYS) {
    const target = storage.getBoolean(`${key}::u:${toAccountId}`);
    if (target !== undefined) continue;

    const source = storage.getBoolean(`${key}::u:${fromAccountId}`);
    if (source !== undefined) storage.set(`${key}::u:${toAccountId}`, source);
  }
}

/**
 * Movimientos personales y presupuesto. Van aparte porque `personalStore` no usa
 * la clave `data_v1` de los demás.
 */
function mergePersonal(fromAccountId: string, toAccountId: string, report: MergeReport): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('personal');

  const sub = mergeAccountData([[storage, PERSONAL_ENTRIES_KEY]], fromAccountId, toAccountId);
  report.counts.personal = sub.counts[PERSONAL_ENTRIES_KEY] ?? 0;
  if (!sub.sourceWasEmpty) report.sourceWasEmpty = false;

  // El presupuesto es un objeto, no una lista: sólo se adopta si el destino no
  // tiene uno propio (no se pisa un presupuesto que el usuario ya configuró).
  const budgetKey = (uid: string) => `${PERSONAL_BUDGET_KEY}::u:${uid}`;
  const sourceBudget = storage.getString(budgetKey(fromAccountId));
  const targetBudget = storage.getString(budgetKey(toAccountId));
  if (sourceBudget !== undefined && targetBudget === undefined) {
    storage.set(budgetKey(toAccountId), sourceBudget);
  }
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
