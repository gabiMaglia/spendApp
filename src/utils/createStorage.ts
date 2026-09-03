// Abstracción de storage que funciona en Expo Go (memoria) y dev build (MMKV nativo).
// En Expo Go los datos no persisten entre reinicios, pero la UI funciona completa.

export class MemoryStorage {
  private store = new Map<string, string | boolean | number>();
  set(key: string, value: string | boolean | number) { this.store.set(key, value); }
  getString(key: string): string | undefined   { return this.store.get(key) as string  | undefined; }
  getBoolean(key: string): boolean | undefined { return this.store.get(key) as boolean | undefined; }
  getNumber(key: string): number | undefined   { return this.store.get(key) as number  | undefined; }
  delete(key: string)  { this.store.delete(key); }
  contains(key: string): boolean { return this.store.has(key); }
  getAllKeys(): string[] { return [...this.store.keys()]; }
  clearAll() { this.store.clear(); }
}

export interface SimpleStorage {
  set(key: string, value: string | boolean | number): void;
  getString(key: string): string | undefined;
  getBoolean(key: string): boolean | undefined;
  getNumber(key: string): number | undefined;
  delete(key: string): void;
  contains(key: string): boolean;
  /**
   * Todas las claves del bucket.
   *
   * Existe para que la purga de scopes NO dependa de una lista (T-060): puede
   * BARRER el bucket buscando el sufijo de la cuenta en vez de enumerar qué
   * guardó cada módulo. Enumerar es lo que se desincronizó tres veces seguidas
   * — T-055, T-057 y T-060 son el mismo bug con distinta lista.
   */
  getAllKeys(): string[];
  clearAll(): void;
}

// Detecta si corremos en Expo Go (client de la tienda) vs un dev/prod build.
// En Expo Go NO hay módulos nativos → MMKV no existe y la persistencia es
// efímera. En un dev build sí debería andar; si igual falla, queremos ver el
// error REAL (no asumir "Expo Go") para diagnosticar.
export function isExpoGo(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    return Constants?.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}

export function logStorageFailure(id: string, e: unknown): void {
  const reason = e instanceof Error ? e.message : String(e);
  if (isExpoGo()) {
    console.warn(`[storage] Expo Go: sin MMKV nativo. Datos EFÍMEROS para "${id}". Usá un dev build para persistir.`);
  } else {
    console.error(
      `[storage] ⚠️ MMKV falló en un build NATIVO para "${id}" → usando memoria (datos NO persisten). ` +
      `Rebuild necesario o dependencia nativa faltante. Error real: ${reason}`,
    );
  }
}

// Devuelve la clase MMKV si el módulo nativo está disponible, o null (logueando
// el motivo real). Centralizado para que createStorage y el storage cifrado
// compartan la misma detección.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadMMKVClass(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    return MMKV;
  } catch (e) {
    logStorageFailure('mmkv-load', e);
    return null;
  }
}

// Storage en claro (sin cifrar). Para datos NO sensibles con lectura síncrona
// al importar (tema, idioma, settings, tier). Los datos financieros usan
// createSecureStorage (cifrado) — ver src/utils/secureStorage.ts.
/**
 * **Todos los buckets que la app llegó a abrir.**
 *
 * Se llena solo: abrir un bucket lo registra. Existe para que la purga de
 * scopes (T-060) pueda BARRER en vez de enumerar — enumerar es lo que se
 * desincronizó tres veces (T-055, T-057, T-060), siempre igual: una lista que
 * alguien tenía que acordarse de actualizar.
 *
 * Un bucket entra cuando su módulo se importa, y todos los que guardan data por
 * cuenta se importan en el arranque, antes de que la purga corra.
 */
const BUCKETS = new Map<string, SimpleStorage>();

export function bucketsAbiertos(): ReadonlyMap<string, SimpleStorage> {
  return BUCKETS;
}

/** Sólo para tests: olvida los buckets registrados. */
export function __resetBuckets(): void {
  BUCKETS.clear();
}

export function createStorage(id: string): SimpleStorage {
  const yaAbierto = BUCKETS.get(id);
  if (yaAbierto) return yaAbierto;

  const MMKV = loadMMKVClass();
  if (!MMKV) return registrarBucket(id, new MemoryStorage());
  try {
    const mmkv = new MMKV({ id });
    // Prueba de humo: forzamos un acceso nativo para que un fallo de linkeo
    // (JSI) salte ACÁ y no más tarde silenciosamente.
    mmkv.contains('__probe__');
    return registrarBucket(id, mmkv);
  } catch (e) {
    logStorageFailure(id, e);
    return registrarBucket(id, new MemoryStorage());
  }
}

export function registrarBucket(id: string, storage: SimpleStorage): SimpleStorage {
  BUCKETS.set(id, storage);
  return storage;
}
