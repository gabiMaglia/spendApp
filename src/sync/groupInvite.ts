import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import * as Crypto from 'expo-crypto';
import { sealEnvelope, openEnvelope, toHex, fromHex } from './envelopeCrypto';

/**
 * Invitación a un grupo por link (ADR-003, enmienda T-034).
 *
 * Modelo **abierto**, decisión del PO: quien tiene el link entra, sin que nadie
 * apruebe. Eso define QUIÉN puede pasar, no A QUÉ CLAVE se le entrega la llave
 * — que es un problema distinto y sigue necesitando criptografía.
 *
 * El invitado publica su clave pública **sellada con una clave derivada del
 * token**, que viaja dentro del link por un canal que el relay no controla
 * (WhatsApp, mail, lo que sea). Sin el token, el relay no puede fabricar un
 * reclamo válido, así que **no puede sustituir la clave pública del invitado y
 * envolverse la clave del grupo a sí mismo**. La sustitución queda prevenida,
 * no apenas detectable.
 */

const CLAIM_DOMAIN = 'splitp2p/invite/v1';
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // regla de negocio #9
const FINGERPRINT_BYTES = 16;              // 128 bits

/**
 * ⛔ NUNCA usar `utils.randomPrivateKey()` de @noble.
 * Es el único punto de la librería que pide `getRandomValues`, que React Native
 * no provee de forma confiable: en vez de fallar, genera claves con entropía
 * degradada EN SILENCIO. Las privadas salen siempre de `Crypto.getRandomBytes`.
 */
export function generateIdentity(): { privateKey: string; publicKey: string } {
  const priv = Crypto.getRandomBytes(32);
  return { privateKey: toHex(priv), publicKey: toHex(ed25519.getPublicKey(priv)) };
}

/** Huella corta de una clave pública, para que el invitado sepa quién lo invitó. */
export function fingerprint(publicKeyHex: string): string {
  return publicKeyHex.slice(0, FINGERPRINT_BYTES * 2);
}

export type GroupInvite = {
  groupId: string;
  groupName: string;
  /** Secreto compartido fuera de banda. Es lo que autentica el reclamo. */
  token: string;
  /** Huella de quien invita: el invitado la muestra antes de entrar. */
  inviterFingerprint: string;
  expiresAt: number;
};

export function createInvite(
  groupId: string,
  groupName: string,
  inviterPublicKey: string,
  now: number = Date.now(),
): GroupInvite {
  return {
    groupId,
    groupName,
    token: toHex(Crypto.getRandomBytes(32)),
    inviterFingerprint: fingerprint(inviterPublicKey),
    expiresAt: now + INVITE_TTL_MS,
  };
}

/** Link para compartir por cualquier canal. */
export function inviteToLink(invite: GroupInvite): string {
  const params = new URLSearchParams({
    g: invite.groupId,
    n: invite.groupName,
    t: invite.token,
    f: invite.inviterFingerprint,
    e: String(invite.expiresAt),
  });
  return `spendapp://group/join?${params.toString()}`;
}

export function parseInviteLink(link: string): GroupInvite | null {
  try {
    const query = link.split('?')[1];
    if (!query) return null;
    const p = new URLSearchParams(query);

    const groupId = p.get('g'), token = p.get('t'), expiresAt = p.get('e');
    if (!groupId || !token || !expiresAt) return null;

    return {
      groupId,
      groupName: p.get('n') ?? '',
      token,
      inviterFingerprint: p.get('f') ?? '',
      expiresAt: Number(expiresAt),
    };
  } catch {
    return null;
  }
}

/**
 * El vencimiento se evalúa contra el reloj de quien VERIFICA, nunca contra un
 * dato que venga del link: si no, alguien reescribe `e` y la invitación no
 * caduca nunca.
 */
export function isInviteExpired(invite: GroupInvite, now: number = Date.now()): boolean {
  return now > invite.expiresAt;
}

/** Clave simétrica derivada del token: lo que el relay no puede calcular. */
async function inviteKey(token: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${CLAIM_DOMAIN}:${token}`,
  );
  return fromHex(hex.slice(0, 64));
}

export type InviteClaim = {
  groupId: string;
  /** Pública X25519 del invitado: a ella se le envuelve la clave del grupo. */
  wrapPublicKey: string;
  /** Pública Ed25519, su identidad para firmar en el roster. */
  identityPublicKey: string;
  displayName: string;
  claimedAt: number;
};

/** Sella el reclamo con la clave derivada del token. */
export async function sealClaim(token: string, claim: InviteClaim): Promise<string> {
  return sealEnvelope(await inviteKey(token), JSON.stringify(claim));
}

/**
 * Abre un reclamo. `null` si no se pudo: sin el token no se puede fabricar uno
 * válido, así que un reclamo que no abre es basura o un intento de sustitución.
 */
export async function openClaim(token: string, sealed: string): Promise<InviteClaim | null> {
  const plain = openEnvelope(await inviteKey(token), sealed);
  if (plain === null) return null;
  try {
    const claim = JSON.parse(plain) as InviteClaim;
    if (!claim.groupId || !claim.wrapPublicKey || !claim.identityPublicKey) return null;
    return claim;
  } catch {
    return null;
  }
}

/**
 * Envuelve la clave del grupo para el invitado, con X25519 + el mismo AEAD.
 * Sólo su clave privada puede abrirlo: el relay ve un blob opaco.
 */
export function wrapGroupKey(
  groupKeyHex: string,
  recipientWrapPublicKey: string,
  senderPrivateKey: string,
): string {
  const shared = x25519.getSharedSecret(fromHex(senderPrivateKey), fromHex(recipientWrapPublicKey));
  return sealEnvelope(shared.slice(0, 32), groupKeyHex);
}

export function unwrapGroupKey(
  wrapped: string,
  senderWrapPublicKey: string,
  recipientPrivateKey: string,
): string | null {
  const shared = x25519.getSharedSecret(fromHex(recipientPrivateKey), fromHex(senderWrapPublicKey));
  return openEnvelope(shared.slice(0, 32), wrapped);
}

/** Par X25519 para envolver claves. Separado del de firma, como manda el uso. */
export function generateWrapKeypair(): { privateKey: string; publicKey: string } {
  const priv = Crypto.getRandomBytes(32);
  return { privateKey: toHex(priv), publicKey: toHex(x25519.getPublicKey(priv)) };
}
