import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import * as Crypto from 'expo-crypto';
import { toHex, fromHex } from './hexBytes';

/**
 * Cifrado de los sobres del relay (ADR-003).
 *
 * El servidor guarda ciphertext y no puede abrirlo. Esta capa es la cerradura;
 * `relay.ts` es sólo el cartero.
 *
 * **XChaCha20-Poly1305**, elegido por una razón concreta: el nonce extendido de
 * 24 bytes es seguro con valores ALEATORIOS. Los AEAD de nonce corto (12 bytes,
 * como AES-GCM) exigen un contador que no se repita jamás, y acá no hay contador
 * confiable — varios dispositivos escriben en el mismo topic sin coordinarse, y
 * una app puede reinstalarse y volver a empezar de cero. Repetir un nonce con
 * la misma clave rompe la confidencialidad por completo. Con 24 bytes aleatorios
 * la probabilidad de colisión es despreciable y el problema desaparece.
 *
 * Es AEAD: si alguien altera un solo bit del ciphertext, el descifrado FALLA en
 * vez de devolver basura. Eso es lo que hace que un sobre corrupto o inyectado
 * se detecte en vez de aplicarse.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export type GroupKey = Uint8Array;

/** Clave simétrica nueva para un grupo. */
export function generateGroupKey(): GroupKey {
  return Crypto.getRandomBytes(KEY_BYTES);
}

/**
 * Topic del relay: `SHA256(clave_del_grupo ‖ época)`, en hex.
 *
 * Derivarlo de la clave (y no usar el id del grupo) es lo que hace que el
 * servidor no pueda relacionar un topic con un grupo, ni el topic de una época
 * con el de la siguiente. Quien no tiene la clave no puede ni calcular dónde
 * mirar.
 */
export async function deriveTopic(key: GroupKey, epoch: number): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:${epoch}`,
  );
}

/**
 * Cifra un texto plano y devuelve el sobre listo para el relay.
 * Formato: `nonce(24B) ‖ ciphertext`, en base64.
 */
export function sealEnvelope(key: GroupKey, plaintext: string): string {
  assertKey(key);
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));

  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return bytesToBase64(out);
}

/**
 * Abre un sobre. Devuelve `null` si no se puede — clave equivocada, sobre
 * alterado, o basura inyectada por alguien que conoce el topic.
 *
 * Devolver `null` en vez de tirar es deliberado: un sobre ajeno en un topic
 * compartido es una situación ESPERADA (ver la limitación del spike en
 * `supabase/001_mailbox.sql`), no un error de programa. El llamador lo saltea
 * y sigue con el resto de la cola.
 */
export function openEnvelope(key: GroupKey, envelope: string): string | null {
  try {
    assertKey(key);
    const raw = base64ToBytes(envelope);
    if (raw.length <= NONCE_BYTES) return null;

    const nonce = raw.subarray(0, NONCE_BYTES);
    const sealed = raw.subarray(NONCE_BYTES);
    return bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(sealed));
  } catch {
    return null;
  }
}

function assertKey(key: GroupKey): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`clave de grupo inválida: ${key.length} bytes, se esperaban ${KEY_BYTES}`);
  }
}

// --- helpers de codificación -------------------------------------------------
// Escritos a mano porque `Buffer` no existe en React Native y `atob`/`btoa`
// no manejan bytes arbitrarios de forma segura.

// `toHex`/`fromHex` viven en `hexBytes.ts` (sin dependencias) y se re-exportan
// para no tocar a los que ya los importaban desde acá.
export { toHex, fromHex };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0, bits = 0, o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('base64 inválido');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number, len: number;
    if (b < 0x80) { cp = b; len = 1; }
    else if (b < 0xe0) { cp = b & 31; len = 2; }
    else if (b < 0xf0) { cp = b & 15; len = 3; }
    else { cp = b & 7; len = 4; }
    for (let k = 1; k < len; k++) cp = (cp << 6) | (bytes[i + k]! & 63);
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}
