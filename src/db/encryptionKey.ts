// S-01 — Clave de cifrado en reposo (ADR-001 §Seguridad S-01).
//
// Genera (primer arranque) o recupera una clave aleatoria de 256 bits y la
// persiste en el Keychain (iOS) / Keystore (Android) vía expo-secure-store,
// con accesibilidad WHEN_UNLOCKED_THIS_DEVICE_ONLY (no sincroniza a
// iCloud/backup — ADR-001: "accesibilidad THIS_DEVICE_ONLY").
//
// ⚠️ CAVEAT DE ALCANCE (leer antes de asumir que la DB está cifrada):
// Este módulo SOLO gestiona la CLAVE. Enchufar la clave al adapter SQLite
// para que SQLCipher realmente cifre los archivos .db es un spike de API
// concreta (ADR-001 §S-01: "la API concreta del adapter... es un spike de
// implementación para T-002"). Ver el comentario en `src/db/index.ts` sobre
// dónde y cómo se conectaría `encryptionKey` al adapter una vez resuelto el
// spike. Hasta que eso se resuelva, el adapter SQLite estándar usado en
// `src/db/index.ts` NO cifra los datos en disco — no declarar cifrado real.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_KEY = 'splitp2p_db_encryption_key_v1';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Devuelve la clave de cifrado de 256 bits (64 chars hex) para la DB local.
 * Idempotente: si ya existe en SecureStore, la reutiliza; si no, genera una
 * nueva con `expo-crypto` (CSPRNG nativo) y la persiste.
 *
 * No disponible en Expo Go de forma persistente entre reinicios de proceso
 * si SecureStore no está configurado; en dev build (con `expo-secure-store`
 * ya declarado en `app.json`) persiste normalmente en Keychain/Keystore.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  if (existing) return existing;

  const randomBytes = await Crypto.getRandomBytesAsync(32); // 256 bits
  const key = bytesToHex(randomBytes);

  await SecureStore.setItemAsync(SECURE_STORE_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  return key;
}
