import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';
import {
  resolveAccount as resolveAccountPure, confirmLink as confirmLinkPure,
  type AccountIndex, type AccountResolution, type KnownAccount,
} from '@/src/utils/accountIdentity';
import { mergeAccounts } from './accountLink';
import { AUTH_KEYS, profileKey } from './authKeys';

const storage = createSecureStorage('auth');

const KEYS = AUTH_KEYS;

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
function rememberAccount(accountId: string, label: string): void {
  const known = readKnown();
  const i = known.findIndex(a => a.accountId === accountId);
  if (i === -1) known.push({ accountId, label });
  else if (label && known[i].label !== label) known[i] = { accountId, label };
  else return;
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
  /** Decide a qué cuenta pertenece un login. Puede pedir confirmación al usuario. */
  resolveAccount: (providerId: string, email?: string | null) => AccountResolution;
  /** El usuario confirmó que la cuenta es suya: vincula y FUSIONA los datos. */
  confirmAccountLink: (providerId: string, targetAccountId: string) => void;
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
      rememberAccount(user.id, user.email || user.name);
    } else {
      storage.delete(KEYS.USER);
    }
    const isPro = user ? (storage.getBoolean(isProKey(user.id)) ?? false) : false;
    set({ currentUser: user, isPro });
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

  confirmAccountLink: (providerId, targetAccountId) => {
    const { previousAccountId } = confirmLinkPure(accountIndex, providerId, targetAccountId);
    if (previousAccountId) mergeAccounts(previousAccountId, targetAccountId);
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
    // El isPro scopeado del usuario NO se borra: queda para cuando vuelva a entrar.
    set({ currentUser: null, isPro: false });
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
