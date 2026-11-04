import {
  MemoryStorage,
  loadMMKVClass,
  logStorageFailure,
  type SimpleStorage,
  registrarBucket,
} from './createStorage';
import { borrarClaveV1, crearClaveNueva, getOrCreateEncryptionKey, leerClaveExistente, leerClaveV1 } from './encryptionKey';
import { SCOPED_PLAIN } from '@/src/constants/storageBuckets';

// IDs de storage con datos sensibles (financieros / de identidad) que se cifran
// at-rest. El resto (theme/lang/settings/tier) queda en claro por lectura
// síncrona al importar y baja sensibilidad.
export const SECURE_IDS = ['groups', 'expenses', 'payments', 'personal', 'users', 'auth', 'recurring', 'comments', 'groupkeys', 'notices', 'sbauth', 'sbdir'] as const;
export type SecureId = typeof SECURE_IDS[number];

// Instancias cifradas ya construidas por el bootstrap (una por id).
const instances = new Map<string, SimpleStorage>();
// Fallback en memoria por id (Expo Go o si el cifrado falla) — datos efímeros.
const memFallback = new Map<string, SimpleStorage>();
let bootstrapped = false;
// T-264: true si el llavero siguió fallando tras los reintentos y los datos
// sensibles viven sólo en memoria (se pierden al cerrar la app).
let efimero = false;

/** Esperas entre intentos de abrir el llavero al arrancar (un fallo pasajero es lo común). */
const BACKOFF_LLAVERO_MS = [150, 450];

const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** True si la sesión corre sin persistencia porque no se pudo abrir el llavero. */
export function almacenEsEfimero(): boolean {
  return efimero;
}

function memFor(id: string): SimpleStorage {
  let m = memFallback.get(id);
  if (!m) { m = new MemoryStorage(); memFallback.set(id, m); }
  return m;
}

/** Marca en `enc_meta`: los buckets ya se vaciaron y recifraron con la clave v2. */
export const MARCA_CLAVE_V2 = 'enc_clave_v2';

/** Marca en `enc_meta` (T-248): hay que avisar UNA vez que los datos no se pudieron recuperar. */
const MARCA_AVISO_DATOS_PERDIDOS = 'enc_aviso_datos_perdidos';

/**
 * Carga/genera la clave v2 y abre cada storage sensible CIFRADO.
 *
 * **Arranque en limpio (T-124 L-E, decisión del PO 2026-09-14).** La clave v1
 * daba 64 bits reales (ver `encryptionKey.ts`). Sin la marca `enc_clave_v2`, se
 * vacía cada bucket cifrado y se recifra con la v2, se vacían los buckets en
 * claro por cuenta (`SCOPED_PLAIN`), se escribe la marca y RECIÉN DESPUÉS se
 * borra la clave v1. No se preservan datos: no había instalaciones con datos
 * reales. Si la app muere antes de la marca, el arranque siguiente repite todo
 * y llega al mismo estado (todo vacío con v2): por eso no hay marcas por bucket.
 *
 * **Restauración sin clave (T-248).** Con la marca `enc_clave_v2` pero SIN clave
 * en el llavero (iPhone nuevo cuyo respaldo trajo los archivos y no la clave), no
 * se abren los archivos con una clave recién generada: se deja el aviso, se baja
 * la marca y se sigue por el arranque en limpio. La marca se baja ANTES de crear
 * la clave: si la app muere en el medio, el próximo arranque ya tiene clave pero
 * no marca, y repite el arranque en limpio en vez de abrir basura.
 *
 * Debe llamarse (y await-earse) ANTES de hidratar los stores sensibles. Es
 * idempotente. Si MMKV no está (Expo Go) o el cifrado falla, los proxies caen a
 * memoria y la app sigue funcionando (sin persistir).
 */
export async function bootstrapSecureStorage(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  const MMKV = loadMMKVClass();
  if (!MMKV) return; // Expo Go / sin nativo → proxies usan memoria

  // Meta store EN CLARO: solo guarda marcas de migración (no datos sensibles).
  let meta: SimpleStorage | null = null;
  try { meta = new MMKV({ id: 'enc_meta' }); } catch { meta = null; }

  let yaEnV2 = false;
  try { yaEnV2 = meta?.getBoolean(MARCA_CLAVE_V2) === true; } catch { yaEnV2 = false; }

  let key: string | undefined;
  for (let intento = 0; key === undefined; intento++) {
    try {
      key = await obtenerClave();
    } catch (e) {
      if (intento < BACKOFF_LLAVERO_MS.length) { await esperar(BACKOFF_LLAVERO_MS[intento]); continue; }
      console.error('[secure] no se pudo obtener la clave de cifrado → datos en memoria (no persisten)', e);
      efimero = true;
      return;
    }
  }
  if (key === undefined) return;
  async function obtenerClave(): Promise<string> {
    let key: string;
    const existente = yaEnV2 ? await leerClaveExistente() : null;
    if (existente) {
      key = existente;
    } else if (yaEnV2 && meta) {
      console.warn('[secure] marca v2 sin clave en el llavero (restauración) → arranque en limpio con aviso');
      meta.set(MARCA_AVISO_DATOS_PERDIDOS, true);
      meta.delete(MARCA_CLAVE_V2);
      yaEnV2 = false;
      key = await crearClaveNueva();
    } else {
      key = await getOrCreateEncryptionKey();
    }
    return key;
  }

  if (yaEnV2) {
    for (const id of SECURE_IDS) {
      try {
        const inst: SimpleStorage = new MMKV({ id, encryptionKey: key });
        inst.contains('__probe__'); // smoke test nativo
        instances.set(id, inst);
      } catch (e) {
        logStorageFailure(id, e);
      }
    }
    // Idempotente: si un corte previo dejó la marca escrita pero la v1
    // huérfana (murió justo entre el `meta.set` y el `borrarClaveV1` de más
    // abajo), este arranque la termina de borrar.
    await borrarClaveV1();
    return;
  }

  // ── Arranque en limpio ───────────────────────────────────────────────────
  let claveV1: string | null = null;
  try { claveV1 = await leerClaveV1(); } catch { claveV1 = null; }

  let algunoFallo = false;
  for (const id of SECURE_IDS) {
    try {
      const cifradoConV1 = meta?.getBoolean(`enc_${id}_v1`) === true && !!claveV1;
      const inst: SimpleStorage = cifradoConV1
        ? new MMKV({ id, encryptionKey: claveV1 })
        : new MMKV({ id });
      inst.clearAll();
      (inst as unknown as { recrypt: (k: string) => void }).recrypt(key);
      inst.contains('__probe__'); // smoke test nativo
      instances.set(id, inst);
    } catch (e) {
      // Un id falla → cae a memoria solo ese id; el resto sigue.
      logStorageFailure(id, e);
      algunoFallo = true;
    }
  }

  for (const id of SCOPED_PLAIN) {
    try { new MMKV({ id }).clearAll(); } catch (e) { logStorageFailure(id, e); algunoFallo = true; }
  }

  // Si algún bucket falló —cifrado (SECURE_IDS) O en claro (SCOPED_PLAIN)— NO
  // se escribe la marca ni se borra la v1: el estado final tiene que ser
  // idéntico en los 10 buckets cifrados Y en los buckets en claro por cuenta
  // (spec §3.2). Una marca con cualquiera de ellos sin vaciar/recifrar lo
  // dejaría afuera de todo reintento para siempre, porque el próximo arranque
  // vería `yaEnV2` y ya no repasaría el camino de arranque en limpio para ese
  // bucket — ni para los cifrados ni para los en claro.
  if (algunoFallo || !meta) {
    // Sin marca: el próximo arranque va a repetir el camino de arranque en
    // limpio entero. No se loguean datos ni claves, sólo que quedó pendiente.
    console.warn('[secure] arranque en limpio incompleto (algún bucket falló) → se reintenta en el próximo inicio');
    return;
  }
  meta.set(MARCA_CLAVE_V2, true);
  for (const id of SECURE_IDS) meta.delete(`enc_${id}_v1`);
  await borrarClaveV1();
}

/**
 * T-248: true UNA vez si el arranque tuvo que descartar los datos locales porque
 * la clave no vino con el respaldo. Consume la marca. Llamar después del bootstrap.
 */
export function consumirAvisoDatosPerdidos(): boolean {
  const MMKV = loadMMKVClass();
  if (!MMKV) return false;
  try {
    const meta: SimpleStorage = new MMKV({ id: 'enc_meta' });
    if (meta.getBoolean(MARCA_AVISO_DATOS_PERDIDOS) !== true) return false;
    meta.delete(MARCA_AVISO_DATOS_PERDIDOS);
    return true;
  } catch {
    return false;
  }
}

/** Solo para tests. */
export function __resetSecureStorage(): void {
  instances.clear();
  memFallback.clear();
  bootstrapped = false;
  efimero = false;
}

// Proxy que delega en la instancia cifrada una vez que el bootstrap la creó.
// Se construye al importar el store (antes del bootstrap), pero el primer
// acceso real ocurre en hydrate() — que corre DESPUÉS del bootstrap.
class SecureLazyStorage implements SimpleStorage {
  constructor(private readonly id: string) {}
  private impl(): SimpleStorage {
    return instances.get(this.id) ?? memFor(this.id);
  }
  set(k: string, v: string | boolean | number) { this.impl().set(k, v); }
  getString(k: string) { return this.impl().getString(k); }
  getBoolean(k: string) { return this.impl().getBoolean(k); }
  getNumber(k: string) { return this.impl().getNumber(k); }
  delete(k: string) { this.impl().delete(k); }
  contains(k: string) { return this.impl().contains(k); }
  getAllKeys() { return this.impl().getAllKeys(); }
  clearAll() { this.impl().clearAll(); }
}

/** Storage CIFRADO at-rest para datos sensibles. Ver SECURE_IDS. */
export function createSecureStorage(id: SecureId): SimpleStorage {
  // Se registra el PROXY, no la instancia cifrada: el bucket real todavía no
  // existe cuando esto corre (se crea en el bootstrap) y el proxy ya sabe
  // encontrarlo. Sin registrar, la purga por barrido no vería los buckets
  // cifrados, que son justo donde vive la data del usuario.
  return registrarBucket(id, new SecureLazyStorage(id));
}
