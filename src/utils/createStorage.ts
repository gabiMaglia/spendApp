// Abstracción de storage que funciona en Expo Go (memoria) y dev build (MMKV nativo).
// En Expo Go los datos no persisten entre reinicios, pero la UI funciona completa.

class MemoryStorage {
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

export function createStorage(id: string): SimpleStorage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    return new MMKV({ id });
  } catch {
    console.warn(`[storage] MMKV no disponible (Expo Go). Usando memoria para "${id}".`);
    return new MemoryStorage();
  }
}
