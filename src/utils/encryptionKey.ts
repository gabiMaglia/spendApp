import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Clave de cifrado at-rest para MMKV. Vive en el llavero seguro del dispositivo
// (Keychain iOS / Keystore Android) vía expo-secure-store. Nunca se persiste en
// MMKV ni en texto plano.
//
// T-248 (decisión del PO 2026-11-03, revierte en parte T-124): la accesibilidad
// es AFTER_FIRST_UNLOCK, SIN «THIS_DEVICE_ONLY». Los archivos MMKV viven en
// Documents y SÍ viajan en el respaldo de iCloud / Inicio rápido; si la clave
// no viajaba con ellos, un iPhone nuevo abría los archivos con una clave
// equivocada y la app arrancaba vacía en silencio. Ahora la clave viaja dentro
// del llavero cifrado de Apple, junto con los archivos que protege.
//
// Por qué un NOMBRE nuevo (`_v2m`) y no reescribir el viejo: en iOS,
// `setItemAsync` sobre un nombre existente hace `SecItemUpdate` sólo del valor
// (SecureStoreModule.swift, rama errSecDuplicateItem → update) y NO cambia
// `kSecAttrAccessible`; y la búsqueda no filtra por accesibilidad. El ítem
// viejo se conservaría como THIS_DEVICE_ONLY. Por eso se copia al nombre nuevo.
//
// T-124 L-E (auditoría de seguridad #2): la v1 eran 64 caracteres hex, pero MMKV
// copia como mucho 16 BYTES de la clave (`AESCrypt.cpp:51`, `AES_KEY_LEN`): los
// primeros 16 hex = 8 bytes de entropía, AES-128 con 64 bits reales. La v2 son
// 16 caracteres del ASCII imprimible (94 símbolos): cada uno es 1 byte en UTF-8,
// así que son exactamente los 16 bytes que MMKV usa, ≈104.9 bits. No se usan
// bytes crudos: la clave viaja a nativo como string UTF-8 (`MmkvHostObject.cpp:21`)
// y un carácter > 0x7F ocupa 2 bytes — MMKV la cortaría a mitad de carácter.
const KEY_NAME = 'mmkv_encryption_key_v2m';
// Misma clave, guardada antes de T-248 como THIS_DEVICE_ONLY.
const KEY_NAME_V2_LEGACY = 'mmkv_encryption_key_v2';
const KEY_NAME_V1 = 'mmkv_encryption_key_v1';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
// Para leer/borrar las claves anteriores (la búsqueda no filtra por accesibilidad).
const SECURE_OPTS_LEGACY: SecureStore.SecureStoreOptions = {
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
 * Lee la clave ya existente SIN generar nada, migrándola si hace falta.
 * Orden: nueva → si no hay, la vieja se copia (mismo valor), se verifica la
 * lectura y recién entonces se borra la vieja. Idempotente ante muerte a mitad:
 * con las dos presentes gana la nueva y se termina de borrar la vieja. Si la
 * verificación no coincide, la vieja se conserva y se devuelve su valor.
 * `null` = no hay clave en el llavero (instalación nueva o restauración sin clave).
 */
export async function leerClaveExistente(): Promise<string | null> {
  if (cached) return cached;

  const nueva = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
  if (nueva) {
    cached = nueva;
    await borrarLegacySilencioso();
    return nueva;
  }

  const vieja = await SecureStore.getItemAsync(KEY_NAME_V2_LEGACY, SECURE_OPTS_LEGACY);
  if (!vieja) return null;

  try {
    await SecureStore.setItemAsync(KEY_NAME, vieja, SECURE_OPTS);
    const verificada = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
    if (verificada === vieja) await borrarLegacySilencioso();
  } catch {
    // Sin migrar: la vieja sigue siendo válida y el próximo arranque reintenta.
  }
  cached = vieja;
  return vieja;
}

async function borrarLegacySilencioso(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_NAME_V2_LEGACY, SECURE_OPTS_LEGACY);
  } catch {
    // El próximo arranque lo reintenta; con la nueva presente la vieja no se usa.
  }
}

/** Genera una clave nueva y la guarda en la forma migrable. Sólo si no hay ninguna. */
export async function crearClaveNueva(): Promise<string> {
  const key = await generarClaveMMKV((n) => Crypto.getRandomBytesAsync(n));
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_OPTS);
  cached = key;
  return key;
}

/**
 * Devuelve la clave, generándola de forma idempotente la primera vez.
 * Cachea en memoria para no golpear el llavero en cada acceso.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  return (await leerClaveExistente()) ?? (await crearClaveNueva());
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
