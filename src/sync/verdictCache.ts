import { sha256 } from '@noble/hashes/sha2.js';
import { verifyCore, type CoreVerdict } from './recordSign';
import { canonicalCore, type CoreKind, type CoreRecord } from './recordCore';
import { toHex, utf8Bytes } from './hexBytes';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped, writeScopedLazy, flushScopedWrites } from '@/src/store/userScope';

/**
 * **Caché de veredictos** (T-041 · S3).
 *
 * Verificar cuesta ~4 ms por registro (§C.9 del plan, medido — no el número del
 * README, que es de un Apple M4). El sobre del relay lleva el estado COMPLETO
 * del grupo y se drena cada 20 s por cada miembro que publicó, así que
 * verificar por recepción sería del orden de 2 s de hilo JS por sobre. Se
 * verifica **una vez por firma**, no una vez por recepción: el caso abrumador es
 * el mismo registro retransmitido por todo el mundo, vuelta tras vuelta.
 *
 * **Es estado de seguridad** (riesgo 5 del §QUÉ) y por eso está construida para
 * fallar hacia `no_verificable`, nunca hacia `valida`:
 *
 *  1. la atribución (`k` ∈ `authorKeys`) se resuelve **antes** de mirar la
 *     caché, así que una entrada envenenada no puede saltearla;
 *  2. `no_verificable` no se guarda nunca — es falta de información y cambia
 *     sola cuando aparece la clave;
 *  3. cualquier entrada que no sea exactamente `valida` o `invalida` se
 *     descarta al cargar, y descartar es seguro: se recalcula;
 *  4. la clave es el hash del mensaje verificado, no el id del registro, así
 *     que ningún veredicto se hereda entre contenidos distintos.
 */

const storage = createSecureStorage('users');

export const VERDICT_CACHE_KEY = 'record_verdicts_v1';

/**
 * Techo de entradas (T-153: 256 → 2000). Actividad sola verifica ≥300
 * registros por visita — con 256 el LRU se comía a sí mismo DENTRO de la
 * misma ráfaga de la primera visita, así que ni siquiera la segunda visita
 * encontraba caché para lo que la primera acababa de verificar. Con 64 hex
 * por clave, 2000 entradas son ~156 KB persistidos — el guardado ya no es
 * síncrono por veredicto (ver `guardar()`), así que ese tamaño ya no cuesta
 * un `JSON.stringify` por fila.
 */
export const VERDICT_CACHE_MAX = 2000;

type Cacheable = Extract<CoreVerdict, 'valida' | 'invalida'>;

function esCacheable(v: unknown): v is Cacheable {
  return v === 'valida' || v === 'invalida';
}

/**
 * La clave es el hash de **lo que se verificó**: mensaje canónico + clave + firma.
 *
 * **El §C.9 del plan proponía `(id, rev, hash(sig))` y eso es explotable.** Esa
 * clave identifica al REGISTRO, no al mensaje: un atacante toma un gasto firmado
 * que ya validamos, le cambia el monto y deja `id`, `rev`, `k` y `s` intactos.
 * Misma clave de caché ⇒ hereda el `valida` ⇒ la firma falsa pasa sin tocar la
 * curva. Se encontró escribiendo el test de la caché, con el vector armado.
 *
 * Con el mensaje adentro del hash el problema desaparece por construcción:
 * cualquier cambio en el núcleo —`rev` incluido, que es el caso que el plan sí
 * había visto— produce otra clave y obliga a verificar de nuevo. `v` y la
 * entidad ya viajan adentro del núcleo canónico, así que no hace falta
 * repetirlos.
 *
 * Cuesta un `canonical()` + un SHA-256 por consulta (microsegundos) contra los
 * ~4 ms de curva que evita. `@noble/hashes` no agrega peso: `@noble/curves` ya
 * lo importa para el SHA-512 de Ed25519.
 */
function claveDe<K extends CoreKind>(kind: K, record: CoreRecord[K]): string {
  const { k = '', s = '' } = record as { k?: string; s?: string };
  return toHex(sha256(utf8Bytes(`${canonicalCore(kind, record)}|${k}|${s}`)));
}

/** Insertion-ordered: el `Map` de JS conserva el orden, y de ahí sale el LRU. */
let cache = new Map<string, Cacheable>();
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;

  const raw = readScoped(storage, VERDICT_CACHE_KEY);
  if (!raw) return;

  try {
    const d = JSON.parse(raw) as { e?: unknown };
    if (!Array.isArray(d?.e)) return;

    for (const fila of d.e) {
      if (!Array.isArray(fila) || fila.length !== 2) continue;
      const [clave, verdict] = fila as [unknown, unknown];
      if (typeof clave !== 'string' || !clave) continue;
      if (!esCacheable(verdict)) continue;   // fail-closed: se descarta, se recalcula
      cache.set(clave, verdict);
    }
  } catch {
    // Dato corrupto: se arranca vacía. Perder la caché cuesta tiempo de CPU;
    // leerla mal costaría dejar pasar una firma que no cierra.
    cache = new Map();
  }
}

/**
 * Diferido (T-153, mismo escritor que los stores de datos — T-156): una
 * ráfaga de veredictos nuevos (import, primera visita a una pantalla) ya no
 * hace un `storage.set` con un `JSON.stringify` de la caché entera por CADA
 * veredicto — se agrupa y se escribe una sola vez, ~300 ms después del
 * último. `readScoped` (usado por `cargar()`) vacía lo pendiente antes de
 * leer, así que nadie ve una caché desactualizada por la demora.
 *
 * La REFERENCIA al `Map` se captura ACÁ (`mapa`), no adentro del `serialize`
 * diferido — pero el `[...mapa.entries()]` sí se difiere hasta el vaciado.
 * `cache` es un `let` de módulo que `reloadVerdictCache`/`clearVerdictCache`
 * REASIGNAN (nunca mutan in-place para vaciarla), así que guardar la
 * referencia alcanza para la misma protección que antes tenía sacar una foto
 * con `[...cache.entries()]` en cada llamada: si el cierre leyera `cache` (la
 * variable) en vivo, un reload que corriera ANTES de que venza el debounce
 * pisaría en disco el veredicto recién guardado con un `Map` vacío — la
 * variable ya apuntaría a otro objeto. Con `mapa` fijo, eso no puede pasar.
 *
 * Y a diferencia de la foto, esto NO copia las entradas en cada
 * `rememberVerdict`: con una ráfaga de N veredictos seguidos, sólo el último
 * `guardar()` sobrevive (`writeScopedLazy` reemplaza el `serialize` pendiente
 * en cada llamada), así que copiar en las N-1 llamadas anteriores era basura
 * para el GC que nadie iba a usar. La copia real — `[...mapa.entries()]` — se
 * hace UNA vez, al vaciar.
 */
function guardar(): void {
  const mapa = cache;
  writeScopedLazy(storage, VERDICT_CACHE_KEY, () => JSON.stringify({ e: [...mapa.entries()] }));
}

/** El veredicto ya calculado para esta firma exacta, si lo hay. */
export function cachedVerdict<K extends CoreKind>(
  kind: K, record: CoreRecord[K],
): CoreVerdict | undefined {
  cargar();
  return cache.get(claveDe(kind, record));
}

export function rememberVerdict<K extends CoreKind>(
  kind: K, record: CoreRecord[K], verdict: CoreVerdict,
): void {
  if (!esCacheable(verdict)) return;   // `no_verificable` cambia solo: no se fija
  cargar();

  const clave = claveDe(kind, record);
  cache.delete(clave);                 // re-insertar lo pone al final (LRU)
  cache.set(clave, verdict);

  while (cache.size > VERDICT_CACHE_MAX) {
    const masViejo = cache.keys().next().value;
    if (masViejo === undefined) break;
    cache.delete(masViejo);
  }
  guardar();
}

/**
 * El veredicto del núcleo, con la curva salteada cuando ya la pagamos.
 *
 * Es lo que va a llamar `applyDelta` en S6. Síncrona y sin red, como manda §3.
 */
export function verifiedCore<K extends CoreKind>(
  kind: K, record: CoreRecord[K], authorKeys: readonly string[],
): CoreVerdict {
  const { k, s } = record as { k?: string; s?: string };

  // Los dos descartes de atribución van ANTES de la caché, no después: si la
  // caché pudiera contestar primero, una entrada envenenada con `valida` haría
  // pasar un registro cuyo autor ni siquiera podemos resolver.
  if (!k || !s) return 'no_verificable';
  if (authorKeys.length === 0) return 'no_verificable';
  if (!authorKeys.includes(k)) return 'invalida';

  const hit = cachedVerdict(kind, record);
  if (hit) return hit;

  const verdict = verifyCore(kind, record, authorKeys);
  rememberVerdict(kind, record, verdict);
  return verdict;
}

export function verdictCacheSize(): number {
  cargar();
  return cache.size;
}

/** Vacía memoria y disco. Logout, wipe, tests. */
export function clearVerdictCache(): void {
  // Si quedó un guardado diferido pendiente de un `rememberVerdict` anterior
  // (su timer real de T-156 todavía no venció), se vacía YA antes de pisarlo:
  // sin esto, ese timer puede disparar más tarde — a mitad de otra prueba, o
  // en producción a mitad de otra pantalla — y volver a escribir la foto
  // vieja encima del `''` que este `clearVerdictCache` acaba de dejar.
  flushScopedWrites();
  cache = new Map();
  cargado = true;
  writeScoped(storage, VERDICT_CACHE_KEY, '');
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadVerdictCache(): void {
  cache = new Map();
  cargado = false;
}

/**
 * Sólo para tests (mismo patrón que `__resetAuthorSources` en otros módulos
 * de sync): el `storage` real que usa este módulo, para poder
 * espiar `.set` directamente. `createSecureStorage(id)` construye un proxy
 * NUEVO en cada llamada — el mismo id resuelve al mismo backing store, pero
 * dos proxies son dos objetos distintos, y el escritor diferido (T-156)
 * indexa lo pendiente por identidad del proxy. Sin este acceso, un test que
 * cree su propio `createSecureStorage('users')` para espiar nunca ve las
 * escrituras que programa este módulo con SU proxy.
 */
export function __verdictCacheStorageForTests() {
  return storage;
}
