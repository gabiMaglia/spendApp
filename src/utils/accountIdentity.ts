/**
 * Identidad de cuenta a través de proveedores.
 *
 * Problema (reportado por el PO): entrar con Google y con Apple usando el MISMO
 * mail abría dos cuentas distintas, cada una con sus propios datos. La identidad
 * era el `id` del proveedor (`credential.user` / `u.id`), que difiere entre ellos.
 *
 * Solución: una capa de índice que traduce `providerId → accountId`.
 *
 * El `accountId` de una cuenta es **el primer providerId con el que se la vio**.
 * Esa elección es deliberada: los datos ya guardados están namespaceados por ese
 * id (ver `userScope`), así que reusarlo significa que las cuentas existentes
 * conservan su id y NO hace falta migrar ni mover nada. El segundo proveedor que
 * llegue con el mismo mail se "engancha" a la cuenta que ya existía.
 *
 * El índice por proveedor es lo que hace que funcione con Apple: Apple manda el
 * email SOLO en el primer login, así que en los siguientes no se puede resolver
 * por mail — pero el providerId ya quedó vinculado.
 */

export interface AccountIndex {
  /** accountId ya vinculado a este providerId, si lo hay. */
  getAccountByProvider(providerId: string): string | null;
  /** accountId ya vinculado a este email normalizado, si lo hay. */
  getAccountByEmail(normalizedEmail: string): string | null;
  /** Persiste el vínculo. `normalizedEmail` puede faltar (Apple en re-login). */
  link(providerId: string, accountId: string, normalizedEmail?: string): void;
}

/** Comparación de mails sin distinguir mayúsculas ni espacios al borde. */
export function normalizeEmail(email?: string | null): string | undefined {
  const e = email?.trim().toLowerCase();
  return e ? e : undefined;
}

export type ResolvedAccount = {
  accountId: string;
  /** true si este login enganchó un proveedor nuevo a una cuenta que ya existía. */
  linkedToExisting: boolean;
};

/**
 * Devuelve el accountId que corresponde a este login, creando o reusando el
 * vínculo según el caso. Escribe en el índice (no es pura por diseño: el
 * vínculo tiene que sobrevivir al login).
 */
export function resolveAccountId(
  index: AccountIndex,
  providerId: string,
  email?: string | null,
): ResolvedAccount {
  const normalized = normalizeEmail(email);

  // 1. Ya conocemos este proveedor: manda el vínculo existente.
  //    (Único camino disponible en el 2º login con Apple, que no manda email.)
  const byProvider = index.getAccountByProvider(providerId);
  if (byProvider) {
    // Si recién ahora sabemos el mail, completamos el índice.
    if (normalized && !index.getAccountByEmail(normalized)) {
      index.link(providerId, byProvider, normalized);
    }
    return { accountId: byProvider, linkedToExisting: false };
  }

  // 2. Proveedor nuevo, pero el mail ya pertenece a una cuenta: se engancha.
  if (normalized) {
    const byEmail = index.getAccountByEmail(normalized);
    if (byEmail) {
      index.link(providerId, byEmail, normalized);
      return { accountId: byEmail, linkedToExisting: true };
    }
  }

  // 3. Cuenta nueva. Su accountId es este providerId — así las cuentas que ya
  //    existían antes de este cambio conservan su id y sus datos scopeados.
  index.link(providerId, providerId, normalized);
  return { accountId: providerId, linkedToExisting: false };
}
