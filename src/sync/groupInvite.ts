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
/**
 * Dominio SEPARADO para el topic. Es crítico que no sea el mismo que
 * `CLAIM_DOMAIN`: el topic viaja en claro hasta el servidor, así que si se
 * derivara igual que la clave, **el topic SERÍA la clave** y el relay podría
 * abrir todos los reclamos.
 */
const TOPIC_DOMAIN = 'splitp2p/invite/v1/topic';
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
  return `spendapp://groups/join?${params.toString()}`;
}

/**
 * Reconstruye la invitación desde los parámetros de la ruta.
 *
 * Existe aparte de `parseInviteLink` porque el router entrega los query params
 * ya parseados: volver a armar la URL para re-parsearla sólo agrega una chance
 * de perder el escapado de un nombre con acentos.
 */
export function inviteFromParams(params: Record<string, unknown>): GroupInvite | null {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

  const groupId = str(params.g), token = str(params.t), expiresAt = str(params.e);
  if (!groupId || !token || !expiresAt) return null;
  if (!Number.isFinite(Number(expiresAt))) return null;

  return {
    groupId,
    groupName: str(params.n) ?? '',
    token,
    inviterFingerprint: str(params.f) ?? '',
    expiresAt: Number(expiresAt),
  };
}

export function parseInviteLink(link: string): GroupInvite | null {
  try {
    const query = link.split('?')[1];
    if (!query) return null;
    const p = new URLSearchParams(query);
    return inviteFromParams(Object.fromEntries(p.entries()));
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

/**
 * Buzón donde se encuentran invitador e invitado.
 *
 * Los dos lo derivan del token, que ninguno de los dos le manda al servidor: el
 * relay ve un topic opaco y no puede relacionarlo ni con el grupo ni con la
 * clave (deriva de otro dominio, ver `TOPIC_DOMAIN`).
 */
export async function deriveInviteTopic(token: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${TOPIC_DOMAIN}:${token}`,
  );
}

export type InviteClaim = {
  kind: 'claim';
  groupId: string;
  /** Id de la cuenta del invitado: con éste entra al roster y a los repartos. */
  userId: string;
  /** Pública X25519 del invitado: a ella se le envuelve la clave del grupo. */
  wrapPublicKey: string;
  /** Pública Ed25519, su identidad para firmar en el roster. */
  identityPublicKey: string;
  displayName: string;
  claimedAt: number;
};

/**
 * Entrega de la clave del grupo. **Entregarla es admitir**: no hay un paso de
 * aprobación aparte, quien manda esto ya sumó al invitado al grupo.
 */
export type InviteGrant = {
  kind: 'grant';
  groupId: string;
  /** Para quién es. Con un link abierto entran varios; cada uno tiene el suyo. */
  forUserId: string;
  /** Clave del grupo envuelta para la X25519 del invitado. */
  wrappedKey: string;
  /** Pública X25519 de quien entrega: sin ella el invitado no puede abrirla. */
  senderWrapPublicKey: string;
  /** Pública Ed25519 de quien entrega. Se contrasta con la huella del link. */
  grantedByIdentity: string;
  epoch: number;
  grantedAt: number;
  /** Firma Ed25519 de todo lo anterior. Ver `openGrant`. */
  signature: string;
};

/** Una entrega antes de firmarla: los datos, sin la firma que los cubre. */
export type UnsignedGrant = Omit<InviteGrant, 'kind' | 'signature'>;

type InviteMessage = InviteClaim | InviteGrant;

async function seal(token: string, msg: InviteMessage): Promise<string> {
  return sealEnvelope(await inviteKey(token), JSON.stringify(msg));
}

async function open(token: string, sealed: string): Promise<InviteMessage | null> {
  const plain = openEnvelope(await inviteKey(token), sealed);
  if (plain === null) return null;
  try {
    return JSON.parse(plain) as InviteMessage;
  } catch {
    return null;
  }
}

/** Sella el reclamo con la clave derivada del token. */
export async function sealClaim(token: string, claim: InviteClaim): Promise<string> {
  return seal(token, claim);
}

/**
 * Abre un reclamo. `null` si no se pudo: sin el token no se puede fabricar uno
 * válido, así que un reclamo que no abre es basura o un intento de sustitución.
 *
 * También devuelve `null` para una entrega: los dos tipos comparten buzón y
 * confundirlos sería tratar una clave envuelta como si fuera un miembro nuevo.
 */
export async function openClaim(token: string, sealed: string): Promise<InviteClaim | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'claim') return null;
  if (!msg.groupId || !msg.userId || !msg.wrapPublicKey || !msg.identityPublicKey) return null;
  return msg;
}

/**
 * Lo que se firma de una entrega. Incluye TODO lo que el invitado va a usar
 * para descifrar: si la firma cubriera menos, se podría cambiar lo de afuera
 * (por ejemplo la pública del que envuelve) sin invalidarla.
 */
function grantPayload(g: UnsignedGrant): string {
  return [g.groupId, g.forUserId, g.wrappedKey, g.senderWrapPublicKey, g.epoch].join('|');
}

/** Firma la entrega con la Ed25519 de quien la manda y la sella para el buzón. */
export async function sealGrant(
  token: string,
  grant: UnsignedGrant,
  signingPrivateKey: string,
): Promise<string> {
  const signature = toHex(ed25519.sign(utf8(grantPayload(grant)), fromHex(signingPrivateKey)));
  return seal(token, { ...grant, kind: 'grant', signature });
}

/**
 * Abre una entrega y **verifica quién la mandó**.
 *
 * Con un link abierto, cualquiera que lo tenga puede leer el buzón y escribir
 * en él. Sin esta verificación, un invitado hostil podría mandarle a otro una
 * clave inventada y dejarlo con un grupo que nunca descifra nada. Dos chequeos,
 * y hacen falta los dos:
 *
 *  - la **huella** ata la entrega a quien mandó el link (dato que llegó por un
 *    canal que el relay no controla);
 *  - la **firma** prueba que quien la mandó tiene la privada de esa huella —
 *    sin ella, cualquiera copia la huella del link y se hace pasar por él.
 */
export async function openGrant(
  token: string,
  sealed: string,
  expectedFingerprint: string,
): Promise<InviteGrant | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'grant') return null;
  if (!msg.groupId || !msg.forUserId || !msg.wrappedKey || !msg.grantedByIdentity) return null;

  if (fingerprint(msg.grantedByIdentity) !== expectedFingerprint) return null;

  try {
    const ok = ed25519.verify(
      fromHex(msg.signature),
      utf8(grantPayload(msg)),
      fromHex(msg.grantedByIdentity),
    );
    return ok ? msg : null;
  } catch {
    return null; // firma con formato inválido
  }
}

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
