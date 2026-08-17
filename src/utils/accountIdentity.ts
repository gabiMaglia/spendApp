/**
 * Identidad de cuenta a través de proveedores.
 *
 * Problema (PO, 2026-08-16): entrar con Google y con Apple usando el mismo mail
 * abría dos cuentas separadas, cada una con sus datos. La identidad era el id
 * del proveedor, distinto en cada uno, y `userScope` namespacea por ese id.
 *
 * El PRIMER intento (revertido en 656a95c) falló por dos cosas que este diseño
 * corrige explícitamente:
 *  1. Sólo enganchaba si el proveedor nuevo traía email — y Apple manda el email
 *     UNA sola vez por Apple ID y por app. Para el usuario que ya entró con
 *     Apple alguna vez, nunca volvía a haber mail y nunca enganchaba. Por eso
 *     ahora existe el resultado `confirm`: si no hay mail pero hay otras cuentas
 *     en el device, se le PREGUNTA al usuario (decisión del PO).
 *  2. Enganchar reapuntaba la identidad sin mover los datos, dejándolos
 *     invisibles. Por eso `link` es sólo la mitad: el llamador tiene que fusionar
 *     con `mergeAccountData` (ver `src/store/mergeAccountData.ts`).
 *
 * Política de enlace (decidida por el PO): con email coincidente se engancha
 * solo, sin preguntar. Es seguro acá porque no hay servidor central — las
 * cuentas son namespaces locales de ESTE device, así que el ataque clásico de
 * "reclamo tu mail en otro proveedor y heredo tu cuenta" exige tener el teléfono
 * desbloqueado, y con eso ya se tienen los datos igual.
 */

export interface AccountIndex {
  getAccountByProvider(providerId: string): string | null;
  getAccountByEmail(normalizedEmail: string): string | null;
  /** Cuentas ya vistas en este device, para poder ofrecerlas como candidatas. */
  listKnownAccounts(): KnownAccount[];
  link(providerId: string, accountId: string, normalizedEmail?: string): void;
}

export type KnownAccount = {
  accountId: string;
  /** Para mostrarle al usuario cuál es. */
  label: string;
};

export type AccountResolution =
  /** El proveedor ya estaba vinculado. Camino normal de todo re-login. */
  | { kind: 'existing'; accountId: string }
  /** Cuenta nueva: no hay con qué vincularla. */
  | { kind: 'new'; accountId: string }
  /** El mail coincidió con una cuenta existente: se vinculó sola. */
  | { kind: 'linked'; accountId: string; previousAccountId: string | null }
  /** Sin mail y hay otras cuentas: hay que preguntarle al usuario. */
  | { kind: 'confirm'; providerId: string; candidates: KnownAccount[] };

export function normalizeEmail(email?: string | null): string | undefined {
  const e = email?.trim().toLowerCase();
  return e ? e : undefined;
}

/**
 * Decide a qué cuenta pertenece este login.
 *
 * OJO: cuando devuelve `linked`, `previousAccountId` dice si el proveedor ya
 * tenía cuenta propia con datos. Si no es null, el llamador DEBE fusionar antes
 * de dar el login por bueno, o los datos quedan invisibles.
 */
export function resolveAccount(
  index: AccountIndex,
  providerId: string,
  email?: string | null,
): AccountResolution {
  const normalized = normalizeEmail(email);

  // 1. Proveedor ya conocido: manda el vínculo. Único camino disponible en el
  //    re-login de Apple, que no manda email.
  const byProvider = index.getAccountByProvider(providerId);
  if (byProvider) {
    if (normalized && !index.getAccountByEmail(normalized)) {
      index.link(providerId, byProvider, normalized);
    }
    return { kind: 'existing', accountId: byProvider };
  }

  // 2. El mail ya pertenece a una cuenta ⇒ se engancha sin preguntar.
  if (normalized) {
    const byEmail = index.getAccountByEmail(normalized);
    if (byEmail && byEmail !== providerId) {
      const hadOwnAccount = index.listKnownAccounts().some(a => a.accountId === providerId);
      index.link(providerId, byEmail, normalized);
      return {
        kind: 'linked',
        accountId: byEmail,
        previousAccountId: hadOwnAccount ? providerId : null,
      };
    }
  }

  // 3. Sin mail con el que decidir, pero hay otras cuentas en el device.
  //    No se adivina: se pregunta (decisión del PO).
  if (!normalized) {
    const candidates = index.listKnownAccounts().filter(a => a.accountId !== providerId);
    if (candidates.length > 0) {
      return { kind: 'confirm', providerId, candidates };
    }
  }

  // 4. Cuenta nueva. Su id es este providerId, así las cuentas que ya existían
  //    conservan el suyo y sus datos scopeados siguen donde están.
  index.link(providerId, providerId, normalized);
  return { kind: 'new', accountId: providerId };
}

/**
 * Confirmación del usuario en el caso `confirm`: vincula el proveedor a la
 * cuenta elegida. Devuelve si el proveedor traía cuenta propia (⇒ hay que
 * fusionar datos).
 */
export function confirmLink(
  index: AccountIndex,
  providerId: string,
  targetAccountId: string,
): { previousAccountId: string | null } {
  const hadOwnAccount = index.listKnownAccounts().some(a => a.accountId === providerId);
  index.link(providerId, targetAccountId);
  return { previousAccountId: hadOwnAccount ? providerId : null };
}
