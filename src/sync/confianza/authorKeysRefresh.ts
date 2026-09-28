import {
  knownAuthorKeys, rememberAuthorKey, ES_PUBLICA,
  forgetAuthorKeys as limpiarCache, reloadAuthorKeys as recargarCache,
} from './authorKeysCache';
import { resolveAuthorKeys, cargarDirectorio, __resetAuthorResolveSources } from './authorKeysResolve';

/**
 * Cola de refresco fuera de banda + el atajo D-2 de la propia clave — salió
 * de `authorKeys.ts` (T-192).
 */

type ModuloAlias = { esYo(id: string | null | undefined): boolean };
type ModuloIdentidad = { ensureIdentity(): { publicKey: string } };
let modAlias: ModuloAlias | null | undefined;
let modIdentidad: ModuloIdentidad | null | undefined;

function cargarAlias(): ModuloAlias | null {
  if (modAlias !== undefined) return modAlias;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modAlias = require('@/src/store/identityAlias') as ModuloAlias;
  } catch {
    modAlias = null;
  }
  return modAlias;
}

function cargarIdentidad(): ModuloIdentidad | null {
  if (modIdentidad !== undefined) return modIdentidad;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modIdentidad = require('@/src/store/identityStore') as ModuloIdentidad;
  } catch {
    modIdentidad = null;
  }
  return modIdentidad;
}

/**
 * **La pública de ESTE aparato/cuenta, cuando el autor sos VOS MISMO** (D-2,
 * dictamen del verificador — ronda de retorno 2).
 *
 * **NO entra a `resolveAuthorKeys`** (ronda de retorno 3, residual: es BUG,
 * no decisión del PO). La primera versión de este fix la sumaba ahí, al
 * mismo array que decide "hay clave conocida ⇒ o coincide (`valida`) o no
 * (`invalida`)". Con eso, un registro MÍO firmado en OTRO aparato de la
 * misma cuenta (o antes de reinstalar) — sin que el directorio hubiera
 * aportado nada — pasaba de `no_verificable` a **`invalida`**: la propia,
 * sola, alcanzaba para que "hay al menos una clave conocida" fuera cierto, y
 * como esa clave no coincidía con la del otro aparato, el gate de
 * `verifyCore`/`verifyVote`/`checkSettlement` (`authorKeys.length===0` vs
 * `!authorKeys.includes(k)`) devolvía una acusación que el directorio NUNCA
 * hizo. Mismo agujero en `settlementTrust.checkSettlement`: un `reject` mío
 * hecho desde el otro aparato quedaba ignorado justo cuando la regla de
 * negocio 3 más lo necesita.
 *
 * **La propia sólo puede SUMAR `valida`, nunca producir `invalida`.** Por
 * eso se resuelve APARTE, y quien la usa (`conPropiaSoloParaValida`, acá
 * abajo) la prueba en un segundo intento, INDEPENDIENTE del primero, y sólo
 * adopta ese segundo resultado si es exactamente `valida`. Cualquier otra
 * cosa —incluida una `invalida` de la propia sola, que sólo diría "esto no
 * lo firmé YO con ESTE aparato", nada sobre si es fraudulento— se descarta y
 * queda el veredicto de siempre (peer + directorio, sin la propia).
 *
 * **Guardia obligatoria: `esYo(authorId)`.** Sin ella, cualquiera podría
 * validar un registro a nombre de OTRO con su propia firma — es la clase de
 * ataque exacta que este archivo existe para impedir. La pública propia
 * SÓLO cuenta cuando el registro dice ser mío.
 *
 * Carga perezosa por el mismo motivo que `cargarPeers`/`cargarDirectorio`
 * (`authorKeysResolve.ts`): `identityStore` arrastra `expo-crypto` (nativo),
 * y este archivo lo importa el camino síncrono del merge/delta.
 */
function clavePropia(authorId: string): string | null {
  const alias = cargarAlias();
  if (!alias) return null;
  try {
    if (!alias.esYo(authorId)) return null;
  } catch {
    return null;
  }

  const identidad = cargarIdentidad();
  if (!identidad) return null;
  try {
    const k = identidad.ensureIdentity().publicKey;
    return k && ES_PUBLICA.test(k) ? k : null;
  } catch {
    return null;
  }
}

/**
 * **El único punto donde la propia puede intervenir en una verificación**
 * (D-2, ronda de retorno 3).
 *
 * Corre `verificar` dos veces, nunca combinando las fuentes en un solo
 * array: primero con `authorKeysFor` (peer + directorio, como siempre); si
 * eso ya da `valida`, listo. Si no, un SEGUNDO intento sólo con la propia
 * (si `esYo(authorId)`) — y ese segundo intento sólo puede ADOPTARSE si es
 * exactamente `valida`. Cualquier otro resultado del segundo intento se
 * descarta: el veredicto que queda es el del primero, intacto.
 *
 * Usan esto los tres consumidores que de verdad necesitan la propia:
 * `checkRecord`/`checkVote` (`trustCheck.ts`, para el atajo D-3 y el
 * `forced` propio) y `autoriaTrust.ts`. `checkSettlement`,
 * `recordHealth.observeRecord` y `applyLeave` siguen llamando
 * `authorKeysFor` directo, sin este wrapper, y por lo tanto sin cambio de
 * comportamiento por D-2 — no lo pidieron y el residual de esta ronda es
 * justamente que no lo necesitan.
 */
export function conPropiaSoloParaValida<V>(
  authorId: string,
  presentedKey: string | undefined,
  verificar: (keys: readonly string[]) => V,
  esValida: (v: V) => boolean,
): V {
  const base = verificar(authorKeysFor(authorId, presentedKey));
  if (esValida(base)) return base;

  const propia = clavePropia(authorId);
  if (!propia || (presentedKey !== undefined && propia !== presentedKey)) return base;

  const conPropia = verificar([propia]);
  return esValida(conPropia) ? conPropia : base;
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
 * **Claves presentadas por las que ya le preguntamos al directorio** (D2).
 *
 * `enEspera`: la clave se vio, no la cubríamos, y la consulta todavía no volvió.
 * `preguntadas`: la consulta volvió **con respuesta** y la clave siguió sin
 * quedar cubierta.
 *
 * La distinción entre las dos es la que evita acusar a un autor honesto. Un peer
 * que reinstaló presenta una clave que no tenemos: mientras nadie le preguntó al
 * directorio por ELLA, lo único honesto que se puede decir es "no sé". Recién
 * cuando el directorio contestó y la clave sigue afuera hay una señal.
 *
 * Se registra por clave y no por autor a propósito: una respuesta del directorio
 * de hace diez minutos es ANTERIOR a la reinstalación y no dice nada sobre el
 * teléfono nuevo. Con el registro por autor, la primera consulta de la vida
 * habilitaría la acusación para siempre — que es exactamente el bug que D2
 * levanta.
 */
const enEspera = new Map<string, Set<string>>();
const preguntadas = new Map<string, Set<string>>();

function anotar(mapa: Map<string, Set<string>>, autor: string, clave: string): void {
  const actual = mapa.get(autor);
  if (actual) actual.add(clave);
  else mapa.set(autor, new Set([clave]));
}

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
  const sinCubrir = presentedKey !== undefined && !keys.includes(presentedKey);

  if (keys.length === 0 || sinCubrir) {
    scheduleAuthorRefresh(authorId);
    // Se anota QUÉ clave quedó sin cubrir, no sólo que hay que preguntar: sin
    // eso no se puede distinguir después "el directorio ya contestó sobre esta
    // clave" de "contestó sobre el autor, antes de que ésta existiera" (D2).
    if (sinCubrir && authorId) anotar(enEspera, authorId, presentedKey!);
  }
  return keys;
}

/**
 * ¿El directorio ya contestó sobre esta clave presentada y siguió sin cubrirla?
 *
 * **Es la condición de D2 para poder decir `invalida`.** Mientras devuelva
 * `false`, lo honesto es `no_verificable`: el juego de claves que tenemos puede
 * estar viejo, y una reinstalación legítima se ve exactamente igual que una
 * suplantación hasta que el directorio habla.
 *
 * Vive en memoria como el resto de la cola. Después de un reinicio vuelve a
 * `false`, o sea que la medición arranca conservadora y se gana el derecho a
 * acusar recién cuando volvió a preguntar. Es la dirección correcta del error.
 */
export function authorKeyWasAsked(authorId: string, presentedKey: string): boolean {
  return preguntadas.get(authorId)?.has(presentedKey) ?? false;
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

    /**
     * Hubo RESPUESTA: lo que estaba en espera pasa a preguntado, aunque el
     * directorio haya venido vacío. Sólo acá, y sólo en esta rama — un corte de
     * red, un módulo ausente o un cooldown no son una respuesta, y tratarlos
     * como tal convertiría un problema de conectividad en una acusación (D2).
     */
    const espera = enEspera.get(authorId);
    if (espera) {
      for (const k of espera) if (!nuevas.includes(k)) anotar(preguntadas, authorId, k);
      enEspera.delete(authorId);
    }
    return nuevas;
  } catch {
    return [];
  }
}

/**
 * Drena la cola. Lo llama `drainGroup` sin `await`, igual que `observeAuthor`
 * (`relay/drenar.ts`): es observación, y la observación no se mete en el
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

function olvidarPendientes(): void {
  pendientes.clear();
  ultimaConsulta.clear();
  enEspera.clear();
  preguntadas.clear();
}

/**
 * Suelta la cola de refresco (pendientes, cooldowns, lo preguntado al
 * directorio). Exportado aparte de `reloadAuthorKeys`/`forgetAuthorKeys` para
 * que `session.ts` pueda soltar cache y cola con una llamada DIRECTA a cada
 * módulo dueño de su estado (T-192, mismo patrón que `recordHealthStore.ts`)
 * en vez de pasar por la fachada.
 */
export function reloadAuthorRefreshQueue(): void {
  olvidarPendientes();
}

/** Suelta los módulos cargados perezosamente y la cola. Sólo tests. */
export function __resetAuthorSources(): void {
  __resetAuthorResolveSources();
  olvidarPendientes();
}

/**
 * Vacía memoria y disco — cache Y cola. Logout, wipe, tests. La cola y los
 * tiempos de consulta son afirmaciones sobre los pares de ESTA cuenta:
 * arrastrarlos sería tan incorrecto como arrastrar la caché misma.
 */
export function forgetAuthorKeys(): void {
  limpiarCache();
  olvidarPendientes();
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadAuthorKeys(): void {
  recargarCache();
  // La cola y los tiempos de consulta son afirmaciones sobre los pares de UNA
  // cuenta: arrastrarlos al cambiar de cuenta haría que la nueva empiece con
  // consultas que no le corresponden y con un cooldown que no se ganó.
  olvidarPendientes();
}
