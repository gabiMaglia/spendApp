import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Clave de cifrado at-rest para MMKV. Vive en el llavero seguro del dispositivo
// (Keychain iOS / Keystore Android) vía expo-secure-store, accesible solo con el
// dispositivo desbloqueado y sin backup a iCloud/Google
// (WHEN_UNLOCKED_THIS_DEVICE_ONLY). Nunca se persiste en MMKV ni en texto plano.
//
// T-124 L-E (auditoría de seguridad #2): la v1 eran 64 caracteres hex, pero MMKV
// copia como mucho 16 BYTES de la clave (`AESCrypt.cpp:51`, `AES_KEY_LEN`): los
// primeros 16 hex = 8 bytes de entropía, AES-128 con 64 bits reales. La v2 son
// 16 caracteres del ASCII imprimible (94 símbolos): cada uno es 1 byte en UTF-8,
// así que son exactamente los 16 bytes que MMKV usa, ≈104.9 bits. No se usan
// bytes crudos: la clave viaja a nativo como string UTF-8 (`MmkvHostObject.cpp:21`)
// y un carácter > 0x7F ocupa 2 bytes — MMKV la cortaría a mitad de carácter.
const KEY_NAME = 'mmkv_encryption_key_v2';
const KEY_NAME_V1 = 'mmkv_encryption_key_v1';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Símbolos posibles por carácter de la clave: `0x21`–`0x7E`. */
export const ALFABETO_CLAVE_MMKV = 94;
const LARGO_CLAVE = 16;
const PRIMER_CARACTER = 0x21;
// Mayor múltiplo de 94 que entra en un byte: los bytes >= 188 se descartan para
// que `b % 94` no favorezca a los primeros símbolos (sesgo de módulo).
const LIMITE_RECHAZO = ALFABETO_CLAVE_MMKV * Math.floor(256 / ALFABETO_CLAVE_MMKV);

let cached: string | null = null;

/**
 * Genera una clave de 16 caracteres imprimibles con muestreo por rechazo.
 * Recibe la fuente de bytes para poder testear el rechazo con bytes conocidos.
 */
export async function generarClaveMMKV(fuente: (n: number) => Promise<Uint8Array>): Promise<string> {
  let clave = '';
  while (clave.length < LARGO_CLAVE) {
    const bytes = await fuente(LARGO_CLAVE);
    for (let i = 0; i < bytes.length && clave.length < LARGO_CLAVE; i++) {
      if (bytes[i] >= LIMITE_RECHAZO) continue;
      clave += String.fromCharCode((bytes[i] % ALFABETO_CLAVE_MMKV) + PRIMER_CARACTER);
    }
  }
  return clave;
}

/**
 * Devuelve la clave v2, generándola de forma idempotente la primera vez.
 * Cachea en memoria para no golpear el llavero en cada acceso.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cached) return cached;

  const existing = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
  if (existing) {
    cached = existing;
    return existing;
  }

  const key = await generarClaveMMKV((n) => Crypto.getRandomBytesAsync(n));
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_OPTS);
  cached = key;
  return key;
}

/** La clave v1 si sigue en el llavero (instalaciones previas a T-124), o null. */
export async function leerClaveV1(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_NAME_V1, SECURE_OPTS);
}

/** Borra la clave v1. Idempotente: no falla si ya no existe. */
export async function borrarClaveV1(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_NAME_V1, SECURE_OPTS);
  } catch {
    // Ya no estaba o el llavero no responde: el próximo arranque lo reintenta
    // sólo si la marca v2 no quedó escrita, y si quedó, la v1 ya no se usa.
  }
}

/** Clave ya cargada en memoria, o null si todavía no se llamó a getOrCreate. */
export function getCachedEncryptionKey(): string | null {
  return cached;
}

/** Solo para tests: resetea el cache en memoria. */
export function __resetEncryptionKeyCache(): void {
  cached = null;
}
