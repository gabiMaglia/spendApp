import {
  MemoryStorage,
  loadMMKVClass,
  logStorageFailure,
  type SimpleStorage,
} from './createStorage';
import { getOrCreateEncryptionKey } from './encryptionKey';

// IDs de storage con datos sensibles (financieros / de identidad) que se cifran
// at-rest. El resto (theme/lang/settings/tier) queda en claro por lectura
// síncrona al importar y baja sensibilidad.
export const SECURE_IDS = ['groups', 'expenses', 'payments', 'personal', 'users', 'auth'] as const;
export type SecureId = typeof SECURE_IDS[number];

// Instancias cifradas ya construidas por el bootstrap (una por id).
const instances = new Map<string, SimpleStorage>();
// Fallback en memoria por id (Expo Go o si el cifrado falla) — datos efímeros.
const memFallback = new Map<string, SimpleStorage>();
let bootstrapped = false;

function memFor(id: string): SimpleStorage {
  let m = memFallback.get(id);
  if (!m) { m = new MemoryStorage(); memFallback.set(id, m); }
  return m;
}

/**
 * Carga/genera la clave y abre cada storage sensible CIFRADO. Migra datos
 * existentes en claro a cifrado in-place con `recrypt` (una vez por id, con
 * flag persistido) — así no se pierde nada de lo ya guardado.
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

  let key: string;
  try {
    key = await getOrCreateEncryptionKey();
  } catch (e) {
    console.error('[secure] no se pudo obtener la clave de cifrado → datos en memoria (no persisten)', e);
    return;
  }

  // Meta store EN CLARO: solo guarda flags de migración (no datos sensibles).
  let meta: SimpleStorage | null = null;
  try { meta = new MMKV({ id: 'enc_meta' }); } catch { meta = null; }

  for (const id of SECURE_IDS) {
    try {
      const migratedFlag = `enc_${id}_v1`;
      const already = meta?.getBoolean(migratedFlag) === true;

      let inst: SimpleStorage;
      if (already) {
        // Ya cifrado en una corrida anterior → abrir directo con la clave.
        inst = new MMKV({ id, encryptionKey: key });
      } else {
        // Primera vez: abrir en claro (datos existentes) y cifrar in-place.
        inst = new MMKV({ id });
        (inst as unknown as { recrypt: (k: string) => void }).recrypt(key);
        meta?.set(migratedFlag, true);
      }
      inst.contains('__probe__'); // smoke test nativo
      instances.set(id, inst);
    } catch (e) {
      // Un id falla → cae a memoria solo ese id; el resto sigue.
      logStorageFailure(id, e);
    }
  }
}

/** Solo para tests. */
export function __resetSecureStorage(): void {
  instances.clear();
  memFallback.clear();
  bootstrapped = false;
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
  clearAll() { this.impl().clearAll(); }
}

/** Storage CIFRADO at-rest para datos sensibles. Ver SECURE_IDS. */
export function createSecureStorage(id: SecureId): SimpleStorage {
  return new SecureLazyStorage(id);
}
