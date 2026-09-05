import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * El diario del borrado de cuenta (T-074 §4).
 *
 * El problema de este ticket no es qué borrar: es el **orden**, y que el orden
 * se pueda interrumpir. Los topics del buzón se derivan de las claves de grupo
 * y de los secretos de contacto —datos que el borrado destruye— y purgarlos
 * necesita red, que puede no haber.
 *
 * Por eso los topics se derivan y se anotan ANTES de tocar nada. A partir de
 * que este diario existe, el borrado es **reanudable**: si la app se cierra en
 * el medio, el arranque siguiente lo termina.
 *
 * **No guarda ni un dato del usuario:** un id de cuenta, hashes opacos (los
 * topics ya son digests) y dos números. Vive **sin scope** a propósito: tiene
 * que sobrevivir al barrido que borra el scope.
 */
// El mismo bucket que `authStore` (`authStore.ts:13`), y por el mismo camino:
// `auth` es un id cifrado, y abrirlo con `createStorage` daría OTRA instancia
// para el mismo id — escrituras que el resto de la app no ve.
const storage = createSecureStorage('auth');
const KEY = 'acct::delete_pending';

export type DeleteJournal = {
  accountId: string;
  /** Topics ya derivados. Los que quedan por purgar. */
  pendientes: string[];
  /** Cuántos se purgaron. Para diagnóstico y para la UI de reintento. */
  purgados: number;
  /** `true` si era la última cuenta: al terminar hay que destruir la prenda. */
  ultimaCuenta: boolean;
  startedAt: number;
};

export function readJournal(): DeleteJournal | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as DeleteJournal;
    // Un diario corrupto se descarta en vez de trabar el arranque para siempre:
    // lo peor que pasa es que queden sobres hasta el TTL de 30 días.
    return j && typeof j.accountId === 'string' && Array.isArray(j.pendientes) ? j : null;
  } catch {
    return null;
  }
}

export function writeJournal(j: DeleteJournal): void {
  storage.set(KEY, JSON.stringify(j));
}

export function clearJournal(): void {
  storage.delete(KEY);
}
