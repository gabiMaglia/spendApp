import { fetchAccountKeys } from './deviceKeys';

/**
 * Fase B del ADR-004, **en modo aviso**.
 *
 * La firma del sobre (T-033) prueba que quien lo mandó tiene la privada de SU
 * dispositivo. No prueba que ese dispositivo sea de la cuenta que el delta dice
 * ser: `fromUserId` es un dato adentro del sobre, y quien tenga la clave del
 * grupo puede escribir lo que quiera ahí. El directorio es lo que cierra esa
 * distancia — la pública tiene que estar registrada BAJO esa cuenta, y sólo el
 * dueño de la cuenta puede registrarla (la RLS de `supabase/003`).
 *
 * **Por qué acá no se rechaza nada.** Queda un borde abierto y conocido: Apple
 * manda el claim `email` sólo en la primera autorización, así que un usuario
 * sin email no se puede vincular con su identidad de Google y termina siendo
 * otro `owner` — sus claves no aparecen ni con `account_keys` (005). Cuántos
 * casos reales produce eso NO LO SABEMOS. Encender el rechazo sobre un número
 * que no medimos es exactamente cómo se pierden mensajes en silencio, que es el
 * modo de falla que este proyecto ya se comió tres veces.
 *
 * Así que primero se mide. `unverifiedAuthors()` es ese número. Cuando esté en
 * cero por un tiempo con gente real, recién ahí se discute rechazar (T-041).
 *
 * Vive en memoria, igual que `publishHealth`: es diagnóstico del momento, no
 * dato del usuario.
 */

export type AuthorVerdict =
  /** La pública que firmó está registrada bajo esa cuenta. */
  | 'ok'
  /** Firmó una clave que NO figura en el directorio de esa cuenta. */
  | 'clave_desconocida'
  /** No se pudo preguntar. NO es una sospecha: es falta de información. */
  | 'sin_directorio';

export type AuthorObservation = {
  groupId: string;
  accountId: string;
  senderKey: string;
  at: number;
  /** Cuántas veces se vio lo mismo. Un contador dice más que N filas iguales. */
  count: number;
};

const TTL_CACHE_MS = 5 * 60 * 1000;

const cache = new Map<string, { keys: string[]; at: number }>();
const sospechas = new Map<string, AuthorObservation>();

/**
 * Claves de una cuenta, con caché.
 *
 * Un vacío NO se cachea a propósito: no se puede distinguir "no tiene claves"
 * de "no pude preguntar", y dejar pegado un corte de red por cinco minutos
 * convertiría un problema pasajero en una tanda de avisos falsos.
 */
async function keysOf(accountId: string, ignorarCache = false): Promise<string[]> {
  const hit = cache.get(accountId);
  if (!ignorarCache && hit && Date.now() - hit.at < TTL_CACHE_MS) return hit.keys;

  const keys = await fetchAccountKeys(accountId);
  if (keys.length > 0) cache.set(accountId, { keys, at: Date.now() });
  return keys;
}

export async function checkAuthor(accountId: string, senderKey: string): Promise<AuthorVerdict> {
  if (!accountId || !senderKey) return 'sin_directorio';

  let keys = await keysOf(accountId);
  if (keys.length === 0) return 'sin_directorio';
  if (keys.includes(senderKey)) return 'ok';

  // Puede ser un dispositivo que esa persona registró DESPUÉS de que cacheamos.
  // Antes de anotarla como sospechosa se vuelve a preguntar sin caché: acusar
  // por tener el dato viejo sería el peor de los falsos positivos.
  keys = await keysOf(accountId, true);
  return keys.includes(senderKey) ? 'ok' : 'clave_desconocida';
}

/**
 * Observa quién firmó un sobre. **Nunca decide si se aplica** — el llamador ya
 * lo aplicó o lo va a aplicar igual. Devuelve el veredicto para los tests.
 */
export async function observeAuthor(
  groupId: string, accountId: string, senderKey: string,
): Promise<AuthorVerdict> {
  let verdict: AuthorVerdict;
  try {
    verdict = await checkAuthor(accountId, senderKey);
  } catch {
    return 'sin_directorio'; // observar no puede romper el sync, nunca
  }

  if (verdict !== 'clave_desconocida') return verdict;

  const clave = `${groupId}::${accountId}::${senderKey}`;
  const previa = sospechas.get(clave);
  sospechas.set(clave, {
    groupId, accountId, senderKey,
    at: Date.now(),
    count: (previa?.count ?? 0) + 1,
  });
  return verdict;
}

/** Sobres que se aplicaron pero cuyo firmante no figura en el directorio. */
export function unverifiedAuthors(): AuthorObservation[] {
  return [...sospechas.values()];
}

export function clearAuthorObservations(): void {
  sospechas.clear();
  cache.clear();
}
