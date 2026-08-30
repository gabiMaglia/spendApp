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
const GROUP_KEYS_KEY       = 'data_v1';
const ARCHIVED_KEY         = 'archived_v1';
const INBOX_KEY            = 'inbox_v1';
const INBOX_MAX            = 200;

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
  mergeGroupKeys(fromAccountId, toAccountId);
  mergeArchived(fromAccountId, toAccountId);
  mergeNotices(fromAccountId, toAccountId);
  mergeProfiles(fromAccountId, toAccountId);
  mergeSettings(fromAccountId, toAccountId);
  recordMerge(fromAccountId);
  return report;
}

/**
 * Los scopes fusionados NO se borran en el momento: si la fusión sale mal, los
 * datos originales siguen ahí y se puede volver atrás. Pero sin límite eso deja
 * una copia completa acumulada por cada enlace, para siempre.
 *
 * Política: se anota la fecha del enlace y el scope se purga recién pasado el
 * período de gracia, en un arranque posterior de la app. Suficiente para
 * recuperar datos si algo salió mal, y acotado en el tiempo.
 */
const MERGED_LOG = 'acct::merged_scopes';
export const MERGE_GRACE_DAYS = 30;

type MergedEntry = { scope: string; at: number };

function readMergeLog(): MergedEntry[] {
  const raw = createSecureStorage('auth').getString(MERGED_LOG);
  if (!raw) return [];
  try { return JSON.parse(raw) as MergedEntry[]; } catch { return []; }
}

function writeMergeLog(entries: MergedEntry[]): void {
  createSecureStorage('auth').set(MERGED_LOG, JSON.stringify(entries));
}

function recordMerge(scope: string, now: number = Date.now()): void {
  const log = readMergeLog().filter(e => e.scope !== scope);
  log.push({ scope, at: now });
  writeMergeLog(log);
}

/**
 * Borra los datos de los scopes fusionados hace más de `MERGE_GRACE_DAYS`.
 * Se llama en el arranque; devuelve los scopes purgados.
 */
export function purgeMergedScopes(now: number = Date.now()): string[] {
  const graceMs = MERGE_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const log = readMergeLog();
  const expired = log.filter(e => now - e.at >= graceMs);
  if (expired.length === 0) return [];

  for (const { scope } of expired) {
    for (const name of MERGEABLE_STORES) {
      createSecureStorage(name).delete(`${DATA_KEY}::u:${scope}`);
    }
    const personal = createSecureStorage('personal');
    personal.delete(`${PERSONAL_ENTRIES_KEY}::u:${scope}`);
    personal.delete(`${PERSONAL_BUDGET_KEY}::u:${scope}`);
  }

  writeMergeLog(log.filter(e => now - e.at < graceMs));
  return expired.map(e => e.scope);
}

/** Preferencias por cuenta (toggles de notificación). */
const SETTINGS_KEYS = ['notif_expenses', 'notif_deletions', 'notif_invites'] as const;
/**
 * Preferencias de settings que NO son booleanas.
 *
 * Van aparte porque `mergeSettings` recorría todo con `getBoolean`, así que al
 * agregar `display_currency` (un string) la moneda maestra elegida se perdía en
 * silencio al enlazar cuentas. Es la MISMA clase que T-047 — una clave nueva
 * que no encaja en la forma que el merge asumía — reaparecida el día después.
 */
const SETTINGS_STRING_KEYS = ['display_currency'] as const;

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

  // Misma semántica que arriba: sólo se adopta si el destino no eligió nada.
  // Nunca se pisa una preferencia que el usuario ya fijó en esta cuenta.
  for (const key of SETTINGS_STRING_KEYS) {
    if (storage.getString(`${key}::u:${toAccountId}`) !== undefined) continue;
    const source = storage.getString(`${key}::u:${fromAccountId}`);
    if (source !== undefined) storage.set(`${key}::u:${toAccountId}`, source);
  }
}

/**
 * Claves de grupo. Van aparte porque `GroupKeyRecord` es `{groupId, key, epoch}`
 * y NO tiene `{id, updatedAt}`: `mergeAccountData` no puede tocarlas.
 *
 * Es lo más caro de perder de todo lo que se fusiona. **Sin la clave, el
 * dispositivo no puede descifrar los sobres de ese grupo**: los gastos siguen
 * llegando por el relay y no se pueden leer. El grupo queda mudo sin un solo
 * mensaje de error.
 *
 * Ante el mismo grupo gana la ÉPOCA MAYOR: al rotar una clave cambia el topic,
 * así que quedarse con la vieja sería quedarse escuchando un buzón que ya nadie
 * usa. Nunca se degrada a una época anterior.
 */
function mergeGroupKeys(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('groupkeys');
  const k = (uid: string) => `${GROUP_KEYS_KEY}::u:${uid}`;

  const leer = (uid: string): { groupId: string; key: string; epoch: number }[] => {
    const raw = storage.getString(k(uid));
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return []; // scope corrupto: no puede tumbar el resto de la fusión
    }
  };

  const origen  = leer(fromAccountId);
  if (origen.length === 0) return;

  const destino = leer(toAccountId);
  const porGrupo = new Map(destino.map(r => [r.groupId, r]));
  for (const rec of origen) {
    const actual = porGrupo.get(rec.groupId);
    if (!actual || rec.epoch > actual.epoch) porGrupo.set(rec.groupId, rec);
  }
  storage.set(k(toAccountId), JSON.stringify([...porGrupo.values()]));
}

/**
 * Grupos archivados. Viven en el bucket `groups` pero bajo `archived_v1`, y el
 * merge de listas sólo mira `data_v1` — por eso se perdían.
 *
 * Es una UNIÓN: las dos cuentas son la misma persona, y si guardó un grupo en
 * cualquiera de sus identidades quiso guardarlo. Perder el archivado le hace
 * reaparecer grupos que ya había ordenado.
 */
function mergeArchived(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('groups');
  const k = (uid: string) => `${ARCHIVED_KEY}::u:${uid}`;

  const leer = (uid: string): string[] => {
    const raw = storage.getString(k(uid));
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

  const origen = leer(fromAccountId);
  if (origen.length === 0) return;
  storage.set(k(toAccountId), JSON.stringify([...new Set([...leer(toAccountId), ...origen])]));
}

/**
 * Bandeja de avisos.
 *
 * Va aparte porque no tiene `updatedAt` —el acuse es local y no sincroniza— así
 * que `mergeAccountData`, que resuelve por LWW, no aplica.
 *
 * Decisión del PO (2026-08-30): **todo se fusiona al enlazar cuentas.** Las dos
 * identidades son la misma persona; lo que pasó bajo una le pasó a ella.
 *
 * Se une por `id` y **el acuse gana si existe en cualquiera de las dos**: un
 * aviso ya leído no puede volver a aparecer sin leer, porque haría subir el
 * badge por algo que la persona ya miró. Se ordena por fecha y se recorta al
 * mismo tope que el store, descartando lo más viejo.
 */
function mergeNotices(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('notices');
  const k = (uid: string) => `${INBOX_KEY}::u:${uid}`;

  type Item = { id: string; createdAt: number; readAt: number | null };
  const leer = (uid: string): Item[] => {
    const raw = storage.getString(k(uid));
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  const origen = leer(fromAccountId);
  if (origen.length === 0) return;

  const porId = new Map<string, Item>();
  for (const it of [...leer(toAccountId), ...origen]) {
    const previo = porId.get(it.id);
    if (!previo) { porId.set(it.id, it); continue; }
    // El acuse gana sobre el no-acuse, venga de la cuenta que venga.
    porId.set(it.id, { ...previo, readAt: previo.readAt ?? it.readAt });
  }

  const items = [...porId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, INBOX_MAX);
  storage.set(k(toAccountId), JSON.stringify(items));
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

/**
 * Qué hace la fusión con CADA store scopeado por cuenta.
 *
 * Existe porque la lista de stores a fusionar se enumeraba a mano y se
 * desincronizaba del código: `personal` desapareció en silencio una vez, y
 * `groupkeys` y los archivados otra (T-047). Tres veces el mismo patrón.
 *
 * El guard `accountCoverage.test.ts` compara esta tabla contra los stores que
 * de verdad existen y falla si aparece uno nuevo sin declarar. Agregar un store
 * scopeado obliga a decidir acá qué pasa cuando dos cuentas se fusionan — que
 * es exactamente la decisión que se venía olvidando.
 */
export const COBERTURA_FUSION: Record<string, string> = {
  groupStore:     'fusionado (MERGEABLE_STORES · groups/data_v1)',
  expenseStore:   'fusionado (MERGEABLE_STORES · expenses/data_v1)',
  paymentStore:   'fusionado (MERGEABLE_STORES · payments/data_v1)',
  userStore:      'fusionado (MERGEABLE_STORES · users/data_v1)',
  recurringStore: 'fusionado (MERGEABLE_STORES · recurring/data_v1)',
  commentStore:   'fusionado (MERGEABLE_STORES · comments/data_v1)',
  personalStore:  'aparte · mergePersonal (usa entries_v1 + budget_v1, no data_v1)',
  groupKeyStore:  'aparte · mergeGroupKeys (es {groupId,key,epoch}, sin id/updatedAt; gana la época mayor)',
  archiveStore:   'aparte · mergeArchived (string[] bajo archived_v1, en el bucket groups; unión)',
  settingsStore:  'aparte · mergeSettings (preferencias, no datos)',
  noticeInboxStore: 'aparte · mergeNotices (union por id; el acuse gana sobre el no-acuse). Decision del PO 2026-08-30: TODO se fusiona al enlazar cuentas.',
  userScope:      'no es un store: es el mecanismo de scoping',
};

export { MERGEABLE_STORES };
