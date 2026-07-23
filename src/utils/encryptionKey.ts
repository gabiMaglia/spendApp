import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Clave de cifrado at-rest para MMKV. Se genera UNA vez (256-bit) y vive en el
// llavero seguro del dispositivo (Keychain iOS / Keystore Android) vía
// expo-secure-store, accesible solo con el dispositivo desbloqueado y sin
// backup a iCloud/Google (WHEN_UNLOCKED_THIS_DEVICE_ONLY). Nunca se persiste
// en MMKV ni en texto plano.
const KEY_NAME = 'mmkv_encryption_key_v1';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let cached: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Devuelve la clave de cifrado, generándola de forma idempotente la primera vez.
 * 256 bits (32 bytes) en hex. Cachea en memoria para no golpear el llavero en
 * cada acceso. Seguro de llamar concurrentemente (la 2da llamada usa el cache).
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cached) return cached;

  const existing = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
  if (existing) {
    cached = existing;
    return existing;
  }

  const bytes = await Crypto.getRandomBytesAsync(32); // 256-bit
  const key = bytesToHex(bytes);
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_OPTS);
  cached = key;
  return key;
}

/** Clave ya cargada en memoria, o null si todavía no se llamó a getOrCreate. */
export function getCachedEncryptionKey(): string | null {
  return cached;
}

/** Solo para tests: resetea el cache en memoria. */
export function __resetEncryptionKeyCache(): void {
  cached = null;
}
