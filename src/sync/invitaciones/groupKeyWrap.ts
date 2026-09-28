import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';
import { sealEnvelope, openEnvelope, toHex, fromHex } from '@/src/sync/nucleo/envelopeCrypto';

/**
 * Envoltura X25519 de la clave de grupo hacia el invitado (T-192: salió de
 * `groupInvite.ts`, mismo código). Ver ADR §T-129/T-121 §1.3.4 para el porqué
 * de HKDF sobre el secreto crudo.
 */

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/**
 * Etiqueta de contexto y versión para la derivación de la clave de envoltura
 * (T-129 · T-121 §1.3.4). Antes de este cambio el secreto compartido de X25519
 * se usaba DIRECTO como clave AEAD — RFC 7748 §6.1 recomienda pasarlo por un
 * hash, y no hacerlo es una debilidad de composición (no del algoritmo).
 */
const WRAP_KDF_INFO_PREFIX = 'spendapp/grupo-clave/v2';
/** Prefijo de formato: lo que distingue una envoltura nueva (v2) de una vieja (v1, sin marca). */
const WRAP_V2_PREFIX = 'v2:';

/**
 * Corte de la ventana de transición v1 (QA T-129 ronda 2: la ventana "de 30
 * días" no estaba implementada, sólo documentada).
 *
 * Es una FECHA FIJA en código, no un reloj relativo (`Date.now() - emitidoEn
 * < 30dias` o similar): el reloj de quien VERIFICA (el receptor) es el único
 * que importa acá — igual que en `isInviteExpired` — y una fecha fija no le
 * da a nadie nada que ganar manipulándolo. Si alguien adelanta su propio
 * reloj, sólo logra que SU dispositivo deje de aceptar v1 antes; si lo
 * atrasa, sigue aceptando v1 un rato más, pero eso ya era cierto sin fecha de
 * corte (v1 abría siempre). No hay una fecha de emisión firmada en el sobre
 * v1 (es sólo el secreto crudo, sin metadata) de la que derivar un vencimiento
 * relativo sin tocar el formato del sobre — y tocar el formato está fuera de
 * alcance de este ticket ("sin cambios a sobres ni firmas").
 */
export const V1_ACEPTADO_HASTA = Date.UTC(2026, 9, 14, 0, 0, 0); // 2026-10-14T00:00:00Z

/**
 * Deriva la clave simétrica del secreto X25519 con HKDF-SHA256 (RFC 5869) y
 * separación de dominio. El `info` ata las DOS públicas, en orden canónico
 * (lexicográfico) — así emisor y receptor derivan la misma clave sin que
 * importe quién es "sender" y quién "recipient" en cada llamada, sin acordar
 * nada de antemano.
 */
function deriveWrapKey(shared: Uint8Array, publicKeyA: string, publicKeyB: string): Uint8Array {
  const [first, second] = [publicKeyA, publicKeyB].sort();
  const info = utf8(`${WRAP_KDF_INFO_PREFIX}:${first}:${second}`);
  return hkdf(sha256, shared, undefined, info, 32);
}

/**
 * Envuelve la clave del grupo para el invitado, con X25519 + el mismo AEAD.
 * Sólo su clave privada puede abrirlo: el relay ve un blob opaco.
 *
 * La clave AEAD no es el secreto X25519 crudo: sale de `deriveWrapKey` (HKDF
 * con separación de dominio, T-129). Se emite versionada (`v2:`) para que un
 * receptor que NO sepa de HKDF (código viejo, T-121) falle explícito en vez
 * de intentar abrir con el secreto crudo y de recibir basura silenciosa.
 */
export function wrapGroupKey(
  groupKeyHex: string,
  recipientWrapPublicKey: string,
  senderPrivateKey: string,
): string {
  const senderPublicKey = toHex(x25519.getPublicKey(fromHex(senderPrivateKey)));
  const shared = x25519.getSharedSecret(fromHex(senderPrivateKey), fromHex(recipientWrapPublicKey));
  const key = deriveWrapKey(shared, senderPublicKey, recipientWrapPublicKey);
  return WRAP_V2_PREFIX + sealEnvelope(key, groupKeyHex);
}

/**
 * Abre una envoltura. Acepta v2 (HKDF) siempre, y v1 (secreto crudo, sin
 * prefijo) sólo hasta `V1_ACEPTADO_HASTA`. Pasado ese corte, un sobre v1
 * devuelve `null` — igual que si estuviera corrupto — en vez de intentar
 * abrirlo: la rama v1 sigue en el código (retirarla es un ticket aparte),
 * pero deja de ejecutarse.
 *
 * `ahora` es inyectable (default `Date.now()`) para poder testear los dos
 * lados del corte sin manipular el reloj real.
 */
export function unwrapGroupKey(
  wrapped: string,
  senderWrapPublicKey: string,
  recipientPrivateKey: string,
  ahora: number = Date.now(),
): string | null {
  const shared = x25519.getSharedSecret(fromHex(recipientPrivateKey), fromHex(senderWrapPublicKey));

  if (wrapped.startsWith(WRAP_V2_PREFIX)) {
    const recipientPublicKey = toHex(x25519.getPublicKey(fromHex(recipientPrivateKey)));
    const key = deriveWrapKey(shared, recipientPublicKey, senderWrapPublicKey);
    return openEnvelope(key, wrapped.slice(WRAP_V2_PREFIX.length));
  }

  // v1: sin prefijo, secreto crudo. Deuda heredada de T-121 §1.3.4, en
  // transición sólo hasta el corte fijo — ver `V1_ACEPTADO_HASTA`.
  if (ahora >= V1_ACEPTADO_HASTA) return null;
  return openEnvelope(shared.slice(0, 32), wrapped);
}

/** Par X25519 para envolver claves. Separado del de firma, como manda el uso. */
export function generateWrapKeypair(): { privateKey: string; publicKey: string } {
  const priv = Crypto.getRandomBytes(32);
  return { privateKey: toHex(priv), publicKey: toHex(x25519.getPublicKey(priv)) };
}
