import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';
import {
  resolveAccount as resolveAccountPure, confirmLink as confirmLinkPure,
  keepSeparate as keepSeparatePure,
  type AccountIndex, type AccountResolution, type KnownAccount,
} from '@/src/utils/accountIdentity';
import { mergeAccounts } from './accountLink';
import { signOutOfDirectory } from '@/src/sync/directoryAuth';
import { isRelayConfigured } from '@/src/sync/relay';
import { AUTH_KEYS, profileKey } from './authKeys';

const storage = createSecureStorage('auth');

const KEYS = AUTH_KEYS;

export type LinkResult =
  | { ok: true; probado: boolean }
  | { ok: false; reason: 'sin_prueba' };

// isPro es por-cuenta (la suscripción es de un usuario). La sesión (current_user)
// es global (puntero a la cuenta activa); isPro se scopea por el id del usuario.
function isProKey(uid: string): string {
  return `${KEYS.IS_PRO}::u:${uid}`;
}

// El perfil de cada cuenta (nombre, email, createdAt) se guarda aparte de la
// sesión y el signOut NO lo borra: es dato del usuario, no de la sesión. Sin
// esto, cerrar sesión destruía el nombre editado a mano y Apple —que sólo manda
// fullName en el PRIMER login— no tenía de dónde recuperarlo al volver a entrar.


// Índice de identidad: traduce el id de cada proveedor al id de cuenta, para
// que entrar con Google o con Apple usando el mismo mail caiga en la MISMA
// cuenta. Ver src/utils/accountIdentity.ts. Tampoco se borra en el signOut.
const KNOWN = 'acct::known';

function readKnown(): KnownAccount[] {
  const raw = storage.getString(KNOWN);
  if (!raw) return [];
  try { return JSON.parse(raw) as KnownAccount[]; } catch { return []; }
}

/** Registra una cuenta como vista en este device (para ofrecerla como candidata). */
function rememberAccount(accountId: string, label: string, email?: string): void {
  const known = readKnown();
  const i = known.findIndex(a => a.accountId === accountId);
  const prev = i === -1 ? undefined : known[i];

  // El email NO se sobreescribe con undefined: una vez que lo supimos, lo
  // sabemos. Apple deja de mandarlo después del primer login, y perderlo haría
  // que la cuenta vuelva a ser "indescartable" y molestemos al usuario de nuevo.
  const next: KnownAccount = {
    accountId,
    label: label || prev?.label || accountId,
    email: email ?? prev?.email,
  };

  if (prev && prev.label === next.label && prev.email === next.email) return;

  if (i === -1) known.push(next);
  else known[i] = next;
  storage.set(KNOWN, JSON.stringify(known));
}

/**
 * Proveedores que ESTA SESIÓN probó contra el directorio de claves (T-042).
 *
 * «Probado» significa que Supabase aceptó el `id_token` de ese proveedor
 * (`src/sync/directoryAuth.ts`), o sea que alguien pasó por Google/Apple con
 * las credenciales de esa cuenta. No es una afirmación del cliente.
 *
 * **Vive en memoria y NO se persiste, a propósito.** Una prueba guardada es una
 * credencial vieja: quien agarre el teléfono mañana heredaría la prueba de hoy.
 * Se borra también al cerrar sesión.
 *
 * Lo que NO prueba, y hay que decirlo: el `providerId` que se marca lo elige el
 * cliente a partir de la respuesta del SDK. Lo que el directorio verifica es el
 * token; atar ese token a este id concreto es una suposición local. Cierra el
 * ataque del teléfono desbloqueado —que es el de T-042— y no pretende más.
 */
const proveedoresProbados = new Set<string>();

/** Se llama tras un `signIntoDirectory` exitoso, con el id de ese proveedor. */
export function marcarProveedorProbado(providerId: string): void {
  proveedoresProbados.add(providerId);
}

/** Sólo para tests y para el cierre de sesión. */
export function olvidarPruebasDeProveedor(): void {
  proveedoresProbados.clear();
}

/**
 * Los `providerId` del índice que apuntan a esta cuenta.
 *
 * Exportado para `identityAlias`, que lo usa para sembrar los alias de quien
 * enlazó cuentas antes de T-048: `acct::p:` es privado de este módulo y esa
 * siembra no puede armar el prefijo por su cuenta.
 */
export function proveedoresDeCuenta(accountId: string): string[] {
  const out: string[] = [];
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith('acct::p:')) continue;
    if (storage.getString(key) === accountId) out.push(key.slice('acct::p:'.length));
  }
  return out;
}

/**
 * Saca una cuenta del índice de identidad (T-074 §3.2·A).
 *
 * Sin esto, borrar la cuenta y volver a entrar con el mismo proveedor cae en el
 * **mismo** `accountId` (`accountIdentity.ts`, paso 1 de `resolveAccount`): una
 * cuenta «borrada» que revive con sus claves viejas apuntando a datos que ya no
 * están. Vive acá porque `acct::p:` / `acct::e:` son privados de este módulo.
 *
 * Se borran **por valor**: las entradas cuyo destino es esta cuenta. Las de otra
 * cuenta enlazada se conservan — es el criterio de aceptación 3.
 */
export function forgetAccount(accountId: string): void {
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith('acct::p:') && !key.startsWith('acct::e:')) continue;
    if (storage.getString(key) === accountId) storage.delete(key);
  }
  const known = readKnown().filter(a => a.accountId !== accountId);
  storage.set(KNOWN, JSON.stringify(known));
}

const accountIndex: AccountIndex = {
  getAccountByProvider: (providerId) => storage.getString(`acct::p:${providerId}`) ?? null,
  getAccountByEmail:    (email)      => storage.getString(`acct::e:${email}`) ?? null,
  listKnownAccounts:    readKnown,
  link: (providerId, accountId, email) => {
    storage.set(`acct::p:${providerId}`, accountId);
    if (email) storage.set(`acct::e:${email}`, accountId);
  },
};

interface AuthState {
  currentUser: User | null;
  isPro: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  /** Perfil persistido de una cuenta. Sobrevive al signOut. */
  getStoredProfile: (uid: string) => User | null;
  /** Snapshot del índice de identidad, para diagnóstico (pantalla DEV). */
  identitySnapshot: () => {
    known: KnownAccount[];
    activeAccountId: string | null;
    profiles: Array<{ accountId: string; name: string; email: string }>;
  };
  /** Decide a qué cuenta pertenece un login. Puede pedir confirmación al usuario. */
  resolveAccount: (providerId: string, email?: string | null) => AccountResolution;
  /**
   * El usuario confirmó que la cuenta es suya: vincula y FUSIONA los datos —
   * **si esta sesión probó el proveedor de esa cuenta** (T-042).
   *
   * `probado: false` significa que se fusionó **degradado**, sin directorio.
   */
  confirmAccountLink: (providerId: string, targetAccountId: string) => LinkResult;
  /** El usuario eligió mantenerlas separadas: se registra para que la decisión SOBREVIVA. */
  keepAccountSeparate: (providerId: string, email?: string | null) => void;
  setIsPro: (isPro: boolean) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  isPro: false,
  isLoading: true,

  // Setea la cuenta activa. La (re)hidratación de los stores por-cuenta la
  // dispara el coordinador de sesión (src/store/session.ts) al observar este
  // cambio — por eso acá NO tocamos userStore (evita ciclos y orden incorrecto).
  setUser: (user) => {
    if (user) {
      storage.set(KEYS.USER, JSON.stringify(user));
      // Snapshot durable del perfil. Como editar el nombre en "Yo" también pasa
      // por acá, el cambio queda persistido para el próximo login.
      storage.set(profileKey(user.id), JSON.stringify(user));
      rememberAccount(user.id, user.name || user.email, user.email || undefined);
    } else {
      storage.delete(KEYS.USER);
    }
    const isPro = user ? (storage.getBoolean(isProKey(user.id)) ?? false) : false;
    set({ currentUser: user, isPro });
  },

  identitySnapshot: () => {
    const known = readKnown();
    return {
      known,
      activeAccountId: get().currentUser?.id ?? null,
      profiles: known.map(a => {
        const raw = storage.getString(profileKey(a.accountId));
        let name = '—', email = '—';
        try {
          const u = raw ? (JSON.parse(raw) as User) : null;
          if (u) { name = u.name; email = u.email || '—'; }
        } catch { /* perfil corrupto: se muestra como vacío */ }
        return { accountId: a.accountId, name, email };
      }),
    };
  },

  resolveAccount: (providerId, email) => {
    const r = resolveAccountPure(accountIndex, providerId, email);
    // Enganche automático por email: si el proveedor traía cuenta propia con
    // datos, hay que fusionarlos o quedan invisibles (defecto que hundió v1).
    if (r.kind === 'linked' && r.previousAccountId) {
      mergeAccounts(r.previousAccountId, r.accountId);
    }
    return r;
  },

  keepAccountSeparate: (providerId, email) => {
    keepSeparatePure(accountIndex, providerId, email);
  },

  confirmAccountLink: (providerId, targetAccountId) => {
    /**
     * T-042. Fusionar dos cuentas es unir sus datos, y `mergeAccounts` **no
     * borra el origen**: quien lo consiga se queda con una copia. Hasta hoy lo
     * único que se pedía era tocar «sí» en un `Alert`, así que alcanzaba con
     * agarrar el teléfono desbloqueado en la pantalla de login.
     *
     * Ahora hace falta que **esta sesión haya probado el proveedor de la cuenta
     * destino**. El atacante puede probar el suyo —entra con su Google— pero no
     * el tuyo, que es el punto.
     *
     * **Sin directorio configurado se fusiona igual**, y se dice: la app es
     * offline-first y no puede exigir red para entrar. El ataque sigue
     * disponible en ese caso, y queda declarado en vez de disimulado.
     */
    if (!isRelayConfigured()) {
      const { previousAccountId } = confirmLinkPure(accountIndex, providerId, targetAccountId);
      if (previousAccountId) mergeAccounts(previousAccountId, targetAccountId);
      return { ok: true, probado: false };
    }

    const probado = proveedoresDeCuenta(targetAccountId).some(p => proveedoresProbados.has(p));
    if (!probado) return { ok: false, reason: 'sin_prueba' };

    const { previousAccountId } = confirmLinkPure(accountIndex, providerId, targetAccountId);
    if (previousAccountId) mergeAccounts(previousAccountId, targetAccountId);
    return { ok: true, probado: true };
  },

  getStoredProfile: (uid) => {
    const raw = storage.getString(profileKey(uid));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null; // dato corrupto: se trata como "no hay perfil"
    }
  },

  setIsPro: (isPro) => {
    const uid = get().currentUser?.id;
    if (uid) storage.set(isProKey(uid), isPro);
    set({ isPro });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  signOut: () => {
    storage.delete(KEYS.USER);
    // Las pruebas de proveedor son de ESTA sesión: heredarlas sería dejarle al
    // próximo la credencial del anterior.
    olvidarPruebasDeProveedor();
    // El isPro scopeado del usuario NO se borra: queda para cuando vuelva a entrar.
    set({ currentUser: null, isPro: false });

    // También la sesión del directorio de claves (ADR-004). Va sin await: el
    // logout local no puede quedar esperando a la red.
    void signOutOfDirectory();
  },

  hydrate: () => {
    const raw = storage.getString(KEYS.USER);
    // Un current_user corrupto NO puede tirar acá: hydrate corre dentro del IIFE
    // de app/_layout.tsx, y si lanza, isLoading queda en true para siempre y la
    // app se traba en el splash sin forma de salir. Se degrada a "sin sesión".
    let user: User | null = null;
    try {
      user = raw ? (JSON.parse(raw) as User) : null;
    } catch {
      storage.delete(KEYS.USER); // el perfil NO se toca: se recupera al re-loguear
    }
    const isPro = user ? (storage.getBoolean(isProKey(user.id)) ?? false) : false;
    set({ currentUser: user, isPro, isLoading: false });
  },
}));
