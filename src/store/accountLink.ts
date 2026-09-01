import { createSecureStorage, type SecureId } from '@/src/utils/secureStorage';
import { createStorage, type SimpleStorage } from '@/src/utils/createStorage';
import { mergeAccountData, type MergeReport } from './mergeAccountData';
import { AUTH_KEYS } from './authKeys';
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
const INBOX_MAX = 200;

// ---------------------------------------------------------------------------
// FUENTE ÚNICA: qué datos toca la fusión, y por lo tanto qué tiene que purgar.
// ---------------------------------------------------------------------------
/**
 * **Una sola lista, y se llena sola.**
 *
 * Antes esto eran DOS listas escritas a mano —lo que `mergeAccounts` copia y lo
 * que `purgeMergedScopes` borra— y se desincronizaron sin que nada fallara: la
 * purga dejaba para siempre las claves de grupo, los archivados, la bandeja, el
 * perfil, las preferencias y los contactos del scope absorbido. No era una fuga
 * entre cuentas (nadie lee ese scope) pero contradecía la política de gracia de
 * 30 días que este mismo archivo declara: el usuario cree que después del plazo
 * no queda nada y quedaba casi todo.
 *
 * El arreglo no podía ser una TERCERA lista. Cada dato que la fusión toca
 * declara su ranura con `ranura()`, que **se auto-registra**: agregar algo
 * nuevo lo mete en la purga sin que nadie se acuerde. Es la misma clase de bug
 * que T-055, y la misma forma de cerrarla.
 */
type Ranura = {
  /** Nombre legible, para diagnóstico y para el guard. */
  nombre: string;
  /** Bucket de storage. */
  bucket: string;
  /** Clave sin scopear. */
  base: string;
  /** El bucket donde vive. Perezoso: los storages se abren en el bootstrap. */
  storage: () => SimpleStorage;
  /** La clave COMPLETA, ya scopeada, de una cuenta. */
  key: (uid: string) => string;
};

const RANURAS: Ranura[] = [];

/** Las ranuras registradas. Sólo lectura — se llena por `ranura()`. */
export const RANURAS_FUSION: readonly Ranura[] = RANURAS;

/**
 * Declara una ranura scopeada por cuenta y devuelve su generador de claves.
 *
 * **Es la única forma de armar una clave scopeada en este archivo.** Un test
 * estático lo exige: si alguien vuelve a armar el sufijo de scope a mano,
 * falla — porque esa es exactamente la manera de agregar algo a la fusión sin
 * que la purga se entere.
 */
function ranura(
  bucket: string, base: string, opts: { claro?: boolean } = {},
): (uid: string) => string {
  const abrir = opts.claro
    ? () => createStorage(bucket)
    : () => createSecureStorage(bucket as SecureId);
  const key = (uid: string) => `${base}${SUFIJO}${uid}`;
  RANURAS.push({ nombre: `${bucket}/${base}`, bucket, base, storage: abrir, key });
  return key;
}

/** El sufijo de scope. Vive acá para que `ranura()` sea el único que lo arma. */
const SUFIJO = '::u:';


// Las ranuras, en el mismo orden en que la fusión las toca.
for (const name of MERGEABLE_STORES) ranura(name, DATA_KEY);
const kPersonalEntries = ranura('personal', 'entries_v1');
const kPersonalBudget  = ranura('personal', 'budget_v1');
const kGroupKeys       = ranura('groupkeys', DATA_KEY);
const kArchived        = ranura('groups', 'archived_v1');
const kInbox           = ranura('notices', 'inbox_v1');
const kContactPeers    = ranura('users', 'contact_peers_v1');
const kProfile         = ranura('auth', AUTH_KEYS.PROFILE);

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
  mergeContactPeers(fromAccountId, toAccountId);
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
 * La cuenta activa, leída del storage y NO de `authStore`.
 *
 * Importar el store desde acá cerraría un ciclo (`authStore` → `accountLink`).
 * Además esto corre en el arranque, antes de que el store esté hidratado.
 */
function scopeActivo(): string | null {
  try {
    const raw = createSecureStorage('auth').getString(AUTH_KEYS.USER);
    return raw ? (JSON.parse(raw) as { id?: string }).id ?? null : null;
  } catch {
    return null; // dato corrupto: no se purga nada, que es el lado seguro
  }
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

  /**
   * **Nunca se purga el scope en el que estamos parados.**
   *
   * No debería poder pasar —al fusionar, el índice de identidad reapunta el
   * proveedor a la cuenta destino— pero `confirmLink` puede dejar una entrada
   * vieja apuntando al scope absorbido, y ahí sí se entra con esa sesión. Como
   * borrar es irreversible, el caso raro se resuelve NO borrando: la entrada
   * del log se queda y se reintenta en el próximo arranque.
   */
  const activo = scopeActivo();
  const aPurgar = expired.filter(e => e.scope !== activo);
  if (aPurgar.length === 0) return [];

  for (const { scope } of aPurgar) {
    // Recorre la FUENTE ÚNICA: lo que la fusión copia es exactamente lo que
    // esto borra, y una ranura nueva entra sola. Antes eran dos listas a mano.
    for (const r of RANURAS) r.storage().delete(r.key(scope));
  }

  const purgados = new Set(aPurgar.map(e => e.scope));
  writeMergeLog(log.filter(e => now - e.at < graceMs || !purgados.has(e.scope)));
  return aPurgar.map(e => e.scope);
}

/** Preferencias por cuenta (toggles de notificación). */
const SETTINGS_KEYS = ['notif_expenses', 'notif_deletions', 'notif_invites', 'notif_settlements'] as const;
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
 * Las preferencias viven EN CLARO (`createStorage`), no en el bucket cifrado:
 * son toggles de baja sensibilidad que se leen sincrónicamente al importar.
 * Igual son por cuenta, así que la purga también tiene que alcanzarlas.
 */
const kSetting: Record<string, (uid: string) => string> = Object.fromEntries(
  [...SETTINGS_KEYS, ...SETTINGS_STRING_KEYS].map(
    key => [key, ranura('settings', key, { claro: true })],
  ),
);

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
    const target = storage.getBoolean(kSetting[key]!(toAccountId));
    if (target !== undefined) continue;

    const source = storage.getBoolean(kSetting[key]!(fromAccountId));
    if (source !== undefined) storage.set(kSetting[key]!(toAccountId), source);
  }

  // Misma semántica que arriba: sólo se adopta si el destino no eligió nada.
  // Nunca se pisa una preferencia que el usuario ya fijó en esta cuenta.
  for (const key of SETTINGS_STRING_KEYS) {
    if (storage.getString(kSetting[key]!(toAccountId)) !== undefined) continue;
    const source = storage.getString(kSetting[key]!(fromAccountId));
    if (source !== undefined) storage.set(kSetting[key]!(toAccountId), source);
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
  const k = kGroupKeys;

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
  const k = kArchived;

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
  const k = kInbox;

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
 * Contactos: el buzón y las claves públicas de cada persona que escaneamos.
 *
 * Se fusiona por la misma razón que `groupkeys`, y es la que salió de mirar el
 * ciclo de vida completo: **no se puede reconstruir sin volver a escanear el QR
 * de cada contacto en persona.** Una tarjeta que llega por el relay sólo
 * completa huecos, nunca reemplaza una clave (`savePeerFromCard`), así que
 * perder el peer no se arregla solo — la cuenta destino se queda sin poder
 * mandarle la clave de ningún grupo. Declararlo "reconstruible" hubiera sido
 * falso.
 *
 * Y alcanza con los peers: con la lista en la mano, el destino les anuncia SU
 * tarjeta (otro `userId`, otra huella, así que `cardYaEnviada` no la frena) y el
 * canal se rearma solo en los dos sentidos.
 *
 * Semántica: unión por `userId`, **el destino gana campo por campo y el origen
 * sólo completa lo que falte**. Igual que `savePeerFromCard`, y por el mismo
 * motivo: pisar una clave verificada en persona con otra sería degradar la única
 * verificación fuerte que tiene el sistema. Las dos cuentas son la misma
 * persona, así que completar huecos es seguro; reemplazar no.
 *
 * NO se fusionan las otras dos claves del módulo, a propósito:
 *  - `contact_secret_v1` es MI buzón, estable por diseño — adoptar otro
 *    invalidaría los códigos que esa cuenta ya mostró;
 *  - `card_sent_v1` es el acuse de MI tarjeta, y la del destino es otra:
 *    heredarlo no ahorra un envío y podría suprimir uno.
 */
function mergeContactPeers(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('users');
  const k = kContactPeers;

  type PeerInfo = { secret: string; wrapPublicKey?: string; identityPublicKey?: string };
  const leer = (uid: string): Record<string, PeerInfo> => {
    const raw = storage.getString(k(uid));
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PeerInfo>) : {};
    } catch {
      return {}; // scope corrupto: no puede tumbar el resto de la fusión
    }
  };

  const origen = leer(fromAccountId);
  if (Object.keys(origen).length === 0) return;

  const destino = leer(toAccountId);
  for (const [userId, peer] of Object.entries(origen)) {
    if (!peer?.secret) continue; // un peer sin buzón no sirve para nada
    const previo = destino[userId];
    destino[userId] = {
      secret:            previo?.secret            ?? peer.secret,
      wrapPublicKey:     previo?.wrapPublicKey     ?? peer.wrapPublicKey,
      identityPublicKey: previo?.identityPublicKey ?? peer.identityPublicKey,
    };
  }
  storage.set(k(toAccountId), JSON.stringify(destino));
}

/**
 * Movimientos personales y presupuesto. Van aparte porque `personalStore` no usa
 * la clave `data_v1` de los demás.
 */
function mergePersonal(fromAccountId: string, toAccountId: string, report: MergeReport): void {
  if (fromAccountId === toAccountId) return;
  const storage = createSecureStorage('personal');

  const sub = mergeAccountData([[storage, 'entries_v1']], fromAccountId, toAccountId);
  report.counts.personal = sub.counts['entries_v1'] ?? 0;
  if (!sub.sourceWasEmpty) report.sourceWasEmpty = false;

  // El presupuesto es un objeto, no una lista: sólo se adopta si el destino no
  // tiene uno propio (no se pisa un presupuesto que el usuario ya configuró).
  const budgetKey = kPersonalBudget;
  const sourceBudget = storage.getString(budgetKey(fromAccountId));
  const targetBudget = storage.getString(budgetKey(toAccountId));
  if (sourceBudget !== undefined && targetBudget === undefined) {
    storage.set(budgetKey(toAccountId), sourceBudget);
  }
}

/**
 * El perfil (nombre y email de la cuenta) va aparte de los demás stores: no es
 * una lista bajo `data_v1` sino un objeto suelto bajo la ranura del perfil, así que
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
    const raw = storage.getString(kProfile(uid));
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

  storage.set(kProfile(toAccountId), JSON.stringify(merged));
}

/**
 * Qué hace la fusión con CADA módulo que persiste scopeado por cuenta.
 *
 * Existe porque la lista se enumeraba a mano y se desincronizaba del código:
 * `personal` desapareció en silencio una vez, y `groupkeys` y los archivados
 * otra (T-047). El guard `accountCoverage.test.ts` compara esta tabla (y la de
 * exclusiones) contra lo que de verdad existe en `src/`, recursivo, y falla si
 * aparece un módulo nuevo sin declarar.
 *
 * Las claves son la ruta desde `src/` sin extensión, no el nombre del archivo:
 * el escaneo dejó de ser de un solo directorio (T-055) y dos módulos con el
 * mismo basename en carpetas distintas compartirían declaración sin que se note.
 */
export const COBERTURA_FUSION: Record<string, string> = {
  'store/groupStore':     'fusionado (MERGEABLE_STORES · groups/data_v1)',
  'store/expenseStore':   'fusionado (MERGEABLE_STORES · expenses/data_v1)',
  'store/paymentStore':   'fusionado (MERGEABLE_STORES · payments/data_v1)',
  'store/userStore':      'fusionado (MERGEABLE_STORES · users/data_v1)',
  'store/recurringStore': 'fusionado (MERGEABLE_STORES · recurring/data_v1)',
  'store/commentStore':   'fusionado (MERGEABLE_STORES · comments/data_v1)',
  'store/personalStore':  'aparte · mergePersonal (usa entries_v1 + budget_v1, no data_v1)',
  'store/groupKeyStore':  'aparte · mergeGroupKeys (es {groupId,key,epoch}, sin id/updatedAt; gana la época mayor)',
  'store/archiveStore':   'aparte · mergeArchived (string[] bajo archived_v1, en el bucket groups; unión)',
  'store/settingsStore':  'aparte · mergeSettings (preferencias, no datos)',
  'store/noticeInboxStore': 'aparte · mergeNotices (union por id; el acuse gana sobre el no-acuse). Decision del PO 2026-08-30: TODO se fusiona al enlazar cuentas.',
  'sync/contactChannel':  'aparte · mergeContactPeers (contact_peers_v1: unión por userId, el destino gana campo por campo). El secreto propio y el acuse de tarjeta NO se fusionan — ver el docblock de mergeContactPeers.',
};

/**
 * Lo que se persiste scopeado por cuenta y **a propósito no se fusiona**, cada
 * uno con su razón.
 *
 * Va en una tabla aparte y no como una nota más en `COBERTURA_FUSION` porque
 * una exclusión es la decisión peligrosa de las dos: es la que hace callar al
 * guard. Diluida entre las coberturas se lee igual que un "listo"; acá, junta
 * con las otras, se audita de un vistazo.
 *
 * El guard sólo puede exigir que la razón esté ESCRITA. Que sea cierta lo tiene
 * que haber verificado quien la escribió — para eso cada una dice cómo se
 * recupera el dato si se pierde.
 */
export const EXCLUIDOS_FUSION: Record<string, string> = {
  'store/userScope':
    'No es data: es el mecanismo de scoping. `writeScoped` está acá porque este módulo lo DEFINE, no porque guarde algo propio.',
  'services/runMigrateReplicated':
    'Marca one-shot "esta cuenta ya migró sus réplicas" (ADR-006), no data del usuario. Fusionarla no aplica y heredarla no haría falta: todo scope que existe en este device llegó ahí por un `rehydrateForActiveUser`, y ése corre la migración. La cuenta origen ya migró lo suyo antes de que se fusione.',
  'sync/authorHealth':
    'Medición de la fase B de ADR-004: cuántos sobres verificaron y cuáles no. Diagnóstico, no data del usuario — el único consumidor es la pantalla DEV `app/debug/identity.tsx`, no gatea ni bloquea nada. Se vuelve a acumular con el uso; sumar los contadores de dos cuentas mezclaría observaciones sobre pares distintos.',
  'sync/verdictCache':
    'Caché de veredictos de firma ya calculados (T-041). Reconstruible verificando de nuevo: lo único que cuesta perderla es CPU en la próxima bajada, y los registros vuelven a viajar enteros en cada sobre.',
  'sync/authorKeys':
    'Caché de las públicas que el directorio ya devolvió (T-041). Reconstruible: se vuelve a consultar el directorio, que es la fuente de verdad. No contiene nada que el directorio no pueda volver a dar.',
  'sync/ratchet':
    'Trinquete "a este autor ya le vimos firmar" (T-041). Hoy NO bloquea nada — decisión R1 del PO: se marca, no se rechaza; su único consumidor es el denominador de la medición en recordHealth. Se retraba solo con la primera firma válida que llegue. OJO: el día que el trinquete pase a gatillar rechazo, esta exclusión deja de ser válida y tiene que moverse a la cobertura.',
  'sync/recordHealth':
    'Medición de T-041: cuántos registros verificaron, fallaron o no eran verificables. Mismo caso que authorHealth — diagnóstico para decidir si se enciende el rechazo, no data del usuario, y se reacumula con el uso.',
};

export { MERGEABLE_STORES };
