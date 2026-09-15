import { ed25519 } from '@noble/curves/ed25519.js';
import * as Crypto from 'expo-crypto';
import { fingerprint } from './groupInvite';
import { sealEnvelope, openEnvelope, toHex, fromHex } from './envelopeCrypto';
import type { ContactCard } from './contactChannel';
import { enlaceCompacto, enlaceCompartible, rutaDeEnlace } from '@/src/utils/appLink';
import { codificarInvitacionDeContacto, decodificarInvitacionDeContacto } from '@/src/utils/linkCompacto';
import { esNombreSeguro, limpiarNombre } from '@/src/utils/nombreSeguro';

/**
 * Link de contacto por invitación — token efímero de un solo uso (T-096 · ADR-015).
 *
 * Reemplaza al link de "Compartir" que llevaba el `contactSecret` PERMANENTE de
 * la cuenta directo en la URL: cualquiera que lo reenviara se volvía un contacto
 * mutuo en el acto, sin que el dueño se enterara. Acá en cambio se emite un
 * token de un solo uso; el secreto real viaja recién en la entrega (`grant`),
 * después de que el primer reclamo válido lo consuma — mismo patrón que
 * `groupInvite.ts`/`inviteEngine.ts` para la invitación a grupo.
 *
 * El QR de contacto en persona (`myQRData` en `app/contact/add.tsx`) NO usa este
 * módulo: sigue con el secreto permanente y el alta instantánea del que
 * escanea — su modelo de confianza es presencia física, no reenvío por canal.
 */

const CLAIM_DOMAIN = 'splitp2p/contact-invite/v1';
/** Dominio separado del de claim, igual razón que en `groupInvite.ts`: el topic
 * viaja en claro hasta el servidor, y si derivara igual que la clave el topic
 * SERÍA la clave. */
const TOPIC_DOMAIN = 'splitp2p/contact-invite/v1/topic';
/** Mismo TTL que la invitación a grupo (regla de negocio #9). */
const CONTACT_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export type ContactInvite = {
  /** Nombre de quien comparte: se muestra antes de cualquier red. */
  fromName: string;
  token: string;
  /** Huella de la identidad de quien comparte — se contrasta al abrir el grant. */
  inviterFingerprint: string;
  expiresAt: number;
  /** Quién ya lo canjeó. Sólo en la copia persistida de quien comparte — nunca viaja en el link. */
  claimedBy?: string;
};

export function createContactInvite(
  fromName: string,
  inviterIdentityPublicKey: string,
  now: number = Date.now(),
): ContactInvite {
  return {
    fromName,
    token: toHex(Crypto.getRandomBytes(32)),
    inviterFingerprint: fingerprint(inviterIdentityPublicKey),
    expiresAt: now + CONTACT_INVITE_TTL_MS,
  };
}

export function isContactInviteExpired(invite: ContactInvite, now: number = Date.now()): boolean {
  return now > invite.expiresAt;
}

async function inviteKey(token: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${CLAIM_DOMAIN}:${token}`,
  );
  return fromHex(hex.slice(0, 64));
}

export async function deriveContactInviteTopic(token: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${TOPIC_DOMAIN}:${token}`,
  );
}

type ContactClaimMsg = { kind: 'claim'; card: ContactCard };
type ContactGrantMsg = {
  kind: 'grant';
  card: ContactCard;
  /** Para quién es. Con un link reenviado puede haber más de un reclamante; cada uno tiene el suyo. */
  forUserId: string;
  signedBy: string;
  signature: string;
};
type ContactInviteMessage = ContactClaimMsg | ContactGrantMsg;

/** Lo que abre una entrega válida: la tarjeta real y para quién era. */
export type ContactGrant = { card: ContactCard; forUserId: string };

async function seal(token: string, msg: ContactInviteMessage): Promise<string> {
  return sealEnvelope(await inviteKey(token), JSON.stringify(msg));
}

async function open(token: string, sealed: string): Promise<ContactInviteMessage | null> {
  const plain = openEnvelope(await inviteKey(token), sealed);
  if (plain === null) return null;
  try {
    return JSON.parse(plain) as ContactInviteMessage;
  } catch {
    return null;
  }
}

function tarjetaValida(card: unknown): card is ContactCard {
  const c = card as ContactCard;
  return Boolean(c) && c.kind === 'contact' && Boolean(c.userId) && Boolean(c.name)
    && Boolean(c.contactSecret) && Boolean(c.wrapPublicKey) && Boolean(c.identityPublicKey);
}

/** Publica quién soy: mi propia `ContactCard`, sin firmar — el que comparte no tiene de antemano nada contra qué verificarla. */
export async function sealContactClaim(token: string, card: ContactCard): Promise<string> {
  return seal(token, { kind: 'claim', card });
}

export async function openContactClaim(token: string, sealed: string): Promise<ContactCard | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'claim') return null;
  return tarjetaValida(msg.card) ? msg.card : null;
}

/**
 * Lo que se firma de una entrega: los campos que el que reclama va a confiar,
 * MÁS `forUserId` (T-096 · ADR-015). Sin `forUserId` adentro de lo firmado, un
 * bystander que sólo tiene el link —cualquiera a quien se lo hayan reenviado—
 * podría tomar la entrega real (la ve porque el tópico y la clave simétrica
 * salen del mismo token que él también tiene), reescribirle el destinatario y
 * resellarla para sí mismo sin tocar la firma: la firma seguiría siendo
 * válida porque no cubría ese campo. Ver `groupInvite.ts#grantPayload`, que ya
 * hace exactamente esto para la invitación a grupo.
 */
function grantPayload(card: ContactCard, forUserId: string): string {
  return [card.userId, card.contactSecret, card.wrapPublicKey, card.identityPublicKey, forUserId].join('|');
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
 * Entrega mi tarjeta real, firmada para un destinatario puntual.
 *
 * `forUserId` (T-096 · ADR-015): con un link reenviado, el mismo buzón puede
 * tener más de un reclamo — el primero válido es el único que se admite, pero
 * el sobre de la entrega es público en ese tópico para cualquiera que tenga el
 * token. Sin destinatario, cualquier otro reclamante (admitido o no) leería
 * igual mi tarjeta real, secreto de contacto permanente incluido. Mismo motivo
 * que `forUserId` en `groupInvite.ts#InviteGrant`.
 */
export async function sealContactGrant(
  token: string,
  card: ContactCard,
  forUserId: string,
  signingPrivateKey: string,
): Promise<string> {
  const signedBy = toHex(ed25519.getPublicKey(fromHex(signingPrivateKey)));
  const signature = toHex(ed25519.sign(utf8(grantPayload(card, forUserId)), fromHex(signingPrivateKey)));
  return seal(token, { kind: 'grant', card, forUserId, signedBy, signature });
}

/**
 * Abre una entrega y verifica que la mandó quien dice el link. La clave del
 * token sola no alcanza: cualquiera que lo haya reenviado la conoce también —
 * es justo lo que este mecanismo está cerrando. La huella ata la entrega a la
 * identidad que el link prometió, y la firma prueba que quien la mandó tiene
 * esa privada. `forUserId` viaja DENTRO de lo firmado — ver `grantPayload` —
 * así que el llamador tiene que contrastarlo contra su propio id antes de
 * adoptar nada; acá sólo se verifica que el campo esté y no fue alterado.
 */
export async function openContactGrant(
  token: string,
  sealed: string,
  expectedFingerprint: string,
): Promise<ContactGrant | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'grant') return null;
  if (!tarjetaValida(msg.card) || !msg.signedBy || !msg.signature || !msg.forUserId) return null;
  if (fingerprint(msg.signedBy) !== expectedFingerprint) return null;

  try {
    const ok = ed25519.verify(
      fromHex(msg.signature), utf8(grantPayload(msg.card, msg.forUserId)), fromHex(msg.signedBy),
    );
    return ok ? { card: msg.card, forUserId: msg.forUserId } : null;
  } catch {
    return null; // firma con formato inválido
  }
}

/** Link para compartir por cualquier canal. Compacto si calza; si no, el largo. */
export function contactInviteToLink(invite: ContactInvite): string {
  const codigo = codificarInvitacionDeContacto(invite);
  if (codigo) return enlaceCompacto('i', codigo);

  const params = new URLSearchParams({
    n: limpiarNombre(invite.fromName),
    t: invite.token,
    f: invite.inviterFingerprint,
    e: String(invite.expiresAt),
  });
  return enlaceCompartible('contact/claim', params);
}

export function contactInviteFromParams(params: Record<string, unknown>): ContactInvite | null {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

  const codigo = str(params.c);
  if (codigo !== undefined) return decodificarInvitacionDeContacto(codigo);

  const token = str(params.t), expiresAt = str(params.e);
  if (!token || !expiresAt) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(token)) return null;
  if (!/^\d{1,15}$/.test(expiresAt) || Number(expiresAt) > 2 ** 48 - 1) return null;
  const inviterFingerprint = str(params.f) ?? '';
  if (inviterFingerprint !== '' && !/^[0-9a-fA-F]{32}$/.test(inviterFingerprint)) return null;
  const fromName = str(params.n) ?? '';
  if (fromName !== '' && !esNombreSeguro(fromName)) return null;

  return { fromName, token, inviterFingerprint, expiresAt: Number(expiresAt) };
}

export function parseContactInviteLink(link: string): ContactInvite | null {
  const r = rutaDeEnlace(link);
  if (!r || r.ruta !== 'contact/claim') return null;
  return contactInviteFromParams(Object.fromEntries(r.params.entries()));
}
