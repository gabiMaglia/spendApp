import { fetchAccountKeys } from './deviceKeys';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

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

const storage = createSecureStorage('users');
const K_MEDICION = 'author_health_v1';

const cache = new Map<string, { keys: string[]; at: number }>();
const sospechas = new Map<string, AuthorObservation>();

/**
 * Cuántos sobres cayeron en cada veredicto.
 *
 * Hace falta porque `unverifiedAuthors()` sola MIENTE por omisión: da cero
 * tanto si todo verificó como si no se pudo consultar nada, que son
 * conclusiones opuestas. Un cero sólo significa algo al lado de un `ok`
 * distinto de cero.
 */
const conteo: Record<AuthorVerdict, number> = {
  ok: 0, clave_desconocida: 0, sin_directorio: 0,
};

export function authorStats(): Record<AuthorVerdict, number> {
  cargar();
  return { ...conteo };
}

/**
 * La medición se PERSISTE, a diferencia de `publishHealth`.
 *
 * Aquélla es un diagnóstico del momento: qué falló recién. Ésta es lo contrario
 * — la pregunta que responde ("¿cuántos sobres legítimos rechazaríamos si
 * encendiéramos el rechazo?") sólo se contesta acumulando días de uso real. En
 * memoria se reseteaba en cada arranque y el número vivía siempre cerca de
 * cero, que es exactamente la lectura equivocada que queremos evitar.
 *
 * Va scopeada por cuenta: son observaciones sobre los pares de ESA cuenta.
 */
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;
  const raw = readScoped(storage, K_MEDICION);
  if (!raw) return;
  try {
    const d = JSON.parse(raw) as {
      conteo?: Partial<Record<AuthorVerdict, number>>;
      sospechas?: AuthorObservation[];
    };
    for (const k of ['ok', 'clave_desconocida', 'sin_directorio'] as AuthorVerdict[]) {
      if (typeof d.conteo?.[k] === 'number') conteo[k] = d.conteo[k]!;
    }
    for (const o of d.sospechas ?? []) {
      sospechas.set(`${o.groupId}::${o.accountId}::${o.senderKey}`, o);
    }
  } catch {
    // Dato corrupto: se arranca de cero. Perder la medición es molesto, romper
    // el sync por un JSON mal escrito sería mucho peor.
  }
}

function guardar(): void {
  writeScoped(storage, K_MEDICION, JSON.stringify({
    conteo,
    sospechas: [...sospechas.values()],
  }));
}

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
  cargar();

  let verdict: AuthorVerdict;
  try {
    verdict = await checkAuthor(accountId, senderKey);
  } catch {
    // Observar no puede romper el sync, nunca. Pero tiene que CONTARSE: si no,
    // un directorio que explota se vuelve invisible en la medición.
    conteo.sin_directorio++;
    guardar();
    return 'sin_directorio';
  }

  conteo[verdict]++;
  if (verdict !== 'clave_desconocida') {
    guardar();
    return verdict;
  }

  const clave = `${groupId}::${accountId}::${senderKey}`;
  const previa = sospechas.get(clave);
  sospechas.set(clave, {
    groupId, accountId, senderKey,
    at: Date.now(),
    count: (previa?.count ?? 0) + 1,
  });
  guardar();
  return verdict;
}

/** Sobres que se aplicaron pero cuyo firmante no figura en el directorio. */
export function unverifiedAuthors(): AuthorObservation[] {
  cargar();
  return [...sospechas.values()];
}

export function clearAuthorObservations(): void {
  vaciarMemoria();
  writeScoped(storage, K_MEDICION, '');
}

/** Vacía lo acumulado en memoria. NO toca el disco. */
function vaciarMemoria(): void {
  sospechas.clear();
  cache.clear();
  conteo.ok = 0;
  conteo.clave_desconocida = 0;
  conteo.sin_directorio = 0;
  cargado = false;
}

/**
 * Suelta la medición de la cuenta anterior y vuelve a leer del scope activo.
 * Lo llama `rehydrateForActiveUser` al cambiar de cuenta.
 *
 * A diferencia de `clearAuthorObservations`, NO escribe: borrar acá vaciaría la
 * medición de la cuenta que ENTRA, que es justo lo contrario de lo que se
 * quiere. Sin esta separación, soltar y borrar serían la misma función y la
 * cuenta nueva arrancaría siempre en cero — el mismo modo de falla que el
 * docblock de arriba explica por qué se persiste.
 */
export function reloadAuthorHealth(): void {
  vaciarMemoria();
}
