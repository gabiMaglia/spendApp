import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * **Caché de públicas ya resueltas por autor** (T-041 · S3).
 *
 * Es la fuente 3 del §2 del plan: las claves con las que ya sabemos que hay que
 * verificar los registros de una persona. Las otras dos fuentes —el registro
 * local de peers (`contactChannel.getPeer`) y el directorio por cuenta
 * (`fetchAccountKeys`)— se consultan como UNIÓN con ésta, y ese trabajo es S4.
 *
 * **Por qué existe una caché y no se consulta directo:** el único lugar donde
 * hace falta el veredicto es el merge, y `applyDelta` es síncrono (§3). Una
 * consulta de red adentro del merge no es una opción. Así que acá la API es
 * síncrona y sin red, y el refresco pasa fuera de banda al drenar (S4).
 *
 * **No es un acumulador TOFU, y es deliberado.** Sería cómodo guardar la clave
 * de cualquier registro que verifique contra sí mismo, pero eso deja que el
 * PRIMER registro de un autor desconocido —que puede ser el del atacante— siembre
 * su propia clave y a partir de ahí todo lo que él firme dé `valida`. Acá sólo
 * entra lo que otra fuente ya resolvió. Un autor sin claves resueltas produce
 * `no_verificable`, que por decisión del PO (R1) nunca es un rechazo.
 *
 * Va scopeada por cuenta: son afirmaciones sobre los pares de ESA cuenta.
 */

const storage = createSecureStorage('users');

export const AUTHOR_KEYS_CACHE_KEY = 'author_keys_v1';

/**
 * La clave es del APARATO y no se scopea por cuenta (`identityStore.ts:7-10`),
 * así que una persona con dos teléfonos tiene dos. El techo está para que una
 * cuenta que reinstala muchas veces no haga crecer esto sin fin; se descartan
 * las más viejas, y si hace falta una descartada vuelve por S4.
 */
export const AUTHOR_KEYS_MAX_PER_AUTHOR = 8;

const ES_PUBLICA = /^[0-9a-f]{64}$/i;

let porAutor = new Map<string, string[]>();
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;

  const raw = readScoped(storage, AUTHOR_KEYS_CACHE_KEY);
  if (!raw) return;

  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;

    for (const [autor, valor] of Object.entries(d as Record<string, unknown>)) {
      if (!autor || !Array.isArray(valor)) continue;

      // Se filtra clave por clave: una entrada podrida se lleva sólo lo suyo.
      // Quedarse con MENOS claves degrada a `no_verificable`; quedarse con una
      // de más sería aceptar una firma ajena como buena.
      const limpias = valor.filter(
        (k): k is string => typeof k === 'string' && ES_PUBLICA.test(k),
      );
      if (limpias.length > 0) porAutor.set(autor, limpias.slice(0, AUTHOR_KEYS_MAX_PER_AUTHOR));
    }
  } catch {
    porAutor = new Map();
  }
}

function guardar(): void {
  writeScoped(
    storage, AUTHOR_KEYS_CACHE_KEY,
    JSON.stringify(Object.fromEntries(porAutor.entries())),
  );
}

/** Las públicas que sabemos de este autor. Síncrona, sin red, sin excepciones. */
export function knownAuthorKeys(authorId: string): readonly string[] {
  if (!authorId) return [];
  cargar();
  return porAutor.get(authorId) ?? [];
}

/**
 * Anota una pública como resuelta para un autor.
 *
 * Sólo debería llamarlo quien ya ató la clave a la persona por otra vía (el QR
 * de contacto o el directorio por cuenta). Una clave con formato equivocado se
 * descarta en silencio: guardarla no serviría para verificar nada y ensuciaría
 * la caché.
 */
export function rememberAuthorKey(authorId: string, publicKey: string): void {
  if (!authorId || !ES_PUBLICA.test(publicKey)) return;
  cargar();

  const actuales = porAutor.get(authorId) ?? [];
  if (actuales.includes(publicKey)) return;

  porAutor.set(authorId, [...actuales, publicKey].slice(-AUTHOR_KEYS_MAX_PER_AUTHOR));
  guardar();
}

/** Vacía memoria y disco. Logout, wipe, tests. */
export function forgetAuthorKeys(): void {
  porAutor = new Map();
  cargado = true;
  olvidarPendientes();
  writeScoped(storage, AUTHOR_KEYS_CACHE_KEY, '');
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadAuthorKeys(): void {
  porAutor = new Map();
  cargado = false;
  // La cola y los tiempos de consulta son afirmaciones sobre los pares de UNA
  // cuenta: arrastrarlos al cambiar de cuenta haría que la nueva empiece con
  // consultas que no le corresponden y con un cooldown que no se ganó.
  olvidarPendientes();
}

// --- S4 · resolución del autor, fuera de banda -------------------------------

/**
 * **Las tres fuentes se consultan como UNIÓN, nunca como cadena** (§2 del plan).
 *
 * La razón no es estética. `savePeerFromCard` sólo completa huecos y nunca
 * reemplaza una clave que ya teníamos (`contactChannel.ts:432-444`, y es
 * deliberado: si pudiera pisarlas, cualquiera que conozca el buzón mandaría una
 * tarjeta diciendo ser otro). Consecuencia: quien reinstala la app queda para
 * siempre con su clave VIEJA en nuestro registro local. Una cadena que
 * preguntara primero ahí y se conformara con esa respuesta marcaría como
 * `invalida` todo lo que esa persona escriba de ahora en más. La unión lo salva
 * por el directorio, que sí tiene la clave nueva.
 *
 * Las fuentes, y de dónde sale cada una en el camino SÍNCRONO:
 *
 *  1. **Registro local de peers** — `getPeer(autor).identityPublicKey`
 *     (`contactChannel.ts:504-506`). Offline y la más fuerte: llegó por un QR.
 *  2. **Directorio por cuenta** — `fetchAccountKeys` (`deviceKeys.ts:79`, RPC
 *     `account_keys`). Es de red, así que **acá no se consulta**: se consulta
 *     fuera de banda y sus respuestas aterrizan en la fuente 3.
 *  3. **Caché de públicas ya resueltas** — `knownAuthorKeys`, arriba.
 *
 * **Lo que NO hace, y es la mitad del valor:** no acepta una clave por el sólo
 * hecho de que un registro verifique contra sí mismo. Eso dejaría que el primer
 * registro de un autor desconocido —que puede ser el del atacante— siembre su
 * propia clave. Un autor sin claves resueltas produce `no_verificable`, que por
 * decisión del PO (R1) jamás es un rechazo ni una acusación.
 *
 * Límite heredado que conviene tener escrito: la fuente 1 también la puede
 * completar una tarjeta que llegó por el relay, no sólo un QR presencial. No
 * puede PISAR nada, pero para un autor que nunca escaneamos puede sembrar la
 * primera clave. Es el modelo de confianza que ya gobierna la entrega de claves
 * de grupo; T-041 lo hereda, no lo empeora.
 */

/** Sólo lo que se usa de cada módulo: el resto no se carga ni se tipa. */
type ModuloPeers = { getPeer(userId: string): { identityPublicKey?: string } | undefined };
type ModuloDirectorio = { fetchAccountKeys(accountId: string): Promise<string[]> };

/**
 * Los dos módulos se cargan PEREZOSAMENTE y memoizados.
 *
 * `contactChannel` arrastra `expo-crypto`, que es nativo. Este archivo lo
 * importa el merge, o sea el camino del sync: un import arriba de todo lo
 * volvería inutilizable en un build que no traiga ese binario, y eso no falla
 * en la pantalla — falla en el arranque. Ya pasó acá, y es lo que
 * `hexBytes.ts` documenta. Con la carga perezosa, la ausencia se lleva UNA
 * fuente y la unión sigue resolviendo con las otras.
 */
let modPeers: ModuloPeers | null | undefined;
let modDirectorio: ModuloDirectorio | null | undefined;

function cargarPeers(): ModuloPeers | null {
  if (modPeers !== undefined) return modPeers;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modPeers = require('./contactChannel') as ModuloPeers;
  } catch {
    modPeers = null;
  }
  return modPeers;
}

function cargarDirectorio(): ModuloDirectorio | null {
  if (modDirectorio !== undefined) return modDirectorio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modDirectorio = require('./deviceKeys') as ModuloDirectorio;
  } catch {
    modDirectorio = null;
  }
  return modDirectorio;
}

/** Fuente 1. Nunca tira: una fuente rota vale menos que la resolución entera. */
function claveDelPeer(authorId: string): string | null {
  const mod = cargarPeers();
  if (!mod) return null;
  try {
    const k = mod.getPeer(authorId)?.identityPublicKey;
    return k && ES_PUBLICA.test(k) ? k : null;
  } catch {
    return null;
  }
}

/**
 * Las públicas con las que puede haber firmado este autor. **Síncrona y sin
 * red**: es lo que va a llamar el merge, y `applyDelta` es síncrono (§3).
 *
 * Se recorren TODAS las fuentes. Ninguna corta a la siguiente, ni siquiera
 * cuando contesta.
 */
export function resolveAuthorKeys(authorId: string): readonly string[] {
  if (!authorId) return [];

  const union: string[] = [];
  const sumar = (k: string | null | undefined) => {
    if (k && !union.includes(k)) union.push(k);
  };

  sumar(claveDelPeer(authorId));
  for (const k of knownAuthorKeys(authorId)) sumar(k);

  return union;
}

/**
 * Cuánto se espera antes de volver a preguntarle al directorio por el mismo
 * autor. Hay autores que **nunca** se van a resolver —el borde de ADR-004 deja
 * a quien entró por Apple sin `email` como otro `owner`, así que `account_keys`
 * devuelve vacío para siempre— y sin freno cada vuelta del relay les gastaría
 * una consulta, cada 20 s, eternamente.
 */
export const AUTHOR_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Techo de consultas por vuelta de drenado. Un sobre trae el estado completo
 * del grupo: sin techo, un grupo con muchos autores sin resolver dispararía una
 * ráfaga de consultas por vuelta. Lo que sobra queda pendiente y sale en la
 * siguiente.
 */
export const AUTHOR_REFRESH_MAX_POR_VUELTA = 8;

/** Autores que el merge no pudo resolver. En memoria: es una cola, no un dato. */
const pendientes = new Set<string>();
const ultimaConsulta = new Map<string, number>();

/**
 * Anota que a este autor hay que preguntarle al directorio. **Síncrona y sin
 * red**: acá no se consulta nada, sólo se encola. La consulta pasa fuera de
 * banda, al drenar.
 */
export function scheduleAuthorRefresh(authorId: string): void {
  if (!authorId) return;
  pendientes.add(authorId);
}

/** Lo que quedó encolado. Para el drenado y para los tests. */
export function pendingAuthorRefreshes(): readonly string[] {
  return [...pendientes];
}

/**
 * Las claves del autor **y** el encolado de la consulta cuando la resolución
 * queda corta. Es la función que llama el merge (S6).
 *
 * Se encola en dos casos, y el segundo es el que importa: no sólo cuando no
 * sabemos NADA del autor, también cuando sabemos algo pero ninguna de esas
 * claves es la que firmó. Ése es exactamente el caso de la reinstalación —el
 * que la unión existe para arreglar—, y con el encolado atado sólo al primero
 * nunca se consultaría.
 */
export function authorKeysFor(authorId: string, presentedKey?: string): readonly string[] {
  const keys = resolveAuthorKeys(authorId);
  if (keys.length === 0 || (presentedKey && !keys.includes(presentedKey))) {
    scheduleAuthorRefresh(authorId);
  }
  return keys;
}

/**
 * Le pregunta al directorio por un autor y guarda lo que traiga. **Es la única
 * parte de S4 que hace red, y va fuera del camino síncrono.**
 *
 * Devuelve las claves que no teníamos, para que el llamador pueda decir si
 * aprendió algo. No tira nunca: el directorio es opcional por diseño (ADR-004
 * fase A) y un corte de red no puede volverse una acusación.
 */
export async function refreshAuthorKeys(authorId: string): Promise<readonly string[]> {
  if (!authorId) return [];
  pendientes.delete(authorId);

  const previa = ultimaConsulta.get(authorId);
  if (previa !== undefined && Date.now() - previa < AUTHOR_REFRESH_COOLDOWN_MS) return [];
  // Se marca ANTES de esperar: dos vueltas del relay que se pisan no pueden
  // salir a preguntar dos veces lo mismo.
  ultimaConsulta.set(authorId, Date.now());

  const dir = cargarDirectorio();
  if (!dir) return [];

  try {
    const traidas = await dir.fetchAccountKeys(authorId);
    const conocidas = knownAuthorKeys(authorId);
    const nuevas = traidas.filter(k => ES_PUBLICA.test(k) && !conocidas.includes(k));
    for (const k of nuevas) rememberAuthorKey(authorId, k);
    return nuevas;
  } catch {
    return [];
  }
}

/**
 * Drena la cola. Lo llama `drainGroup` sin `await`, igual que `observeAuthor`
 * (`relaySync.ts:162`): es observación, y la observación no se mete en el
 * camino del sync ni le suma la latencia de una consulta por vuelta.
 *
 * Secuencial a propósito: no hace falta una ráfaga en paralelo para algo que
 * sirve recién para la próxima vuelta.
 */
export async function refreshPendingAuthors(
  max: number = AUTHOR_REFRESH_MAX_POR_VUELTA,
): Promise<void> {
  for (const authorId of [...pendientes].slice(0, max)) {
    await refreshAuthorKeys(authorId);
  }
}

/** Suelta los módulos cargados perezosamente y la cola. Sólo tests. */
export function __resetAuthorSources(): void {
  modPeers = undefined;
  modDirectorio = undefined;
  olvidarPendientes();
}

function olvidarPendientes(): void {
  pendientes.clear();
  ultimaConsulta.clear();
}
