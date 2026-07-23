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
  clearAll() { this.store.clear(); }
}

export interface SimpleStorage {
  set(key: string, value: string | boolean | number): void;
  getString(key: string): string | undefined;
  getBoolean(key: string): boolean | undefined;
  getNumber(key: string): number | undefined;
  delete(key: string): void;
  contains(key: string): boolean;
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
export function createStorage(id: string): SimpleStorage {
  const MMKV = loadMMKVClass();
  if (!MMKV) return new MemoryStorage();
  try {
    const mmkv = new MMKV({ id });
    // Prueba de humo: forzamos un acceso nativo para que un fallo de linkeo
    // (JSI) salte ACÁ y no más tarde silenciosamente.
    mmkv.contains('__probe__');
    return mmkv;
  } catch (e) {
    logStorageFailure(id, e);
    return new MemoryStorage();
  }
}
