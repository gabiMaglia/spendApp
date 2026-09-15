import { ed25519 } from '@noble/curves/ed25519.js';
import * as Crypto from 'expo-crypto';
import { fingerprint, wrapGroupKey } from './groupInvite';
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
  /**
   * Pública X25519 de envoltura de quien comparte (I1, cierre — revisión final
   * de T-096 · ADR-015). Es información pública, igual que `inviterFingerprint`
   * — viaja en el link a propósito: es contra ELLA que el reclamante envuelve
   * su `contactSecret` en `sealContactClaim`, así sólo la privada de quien
   * comparte lo recupera. Ver el comentario largo en `sealContactClaim`.
   */
  inviterWrapPublicKey: string;
  expiresAt: number;
  /** Quién ya lo canjeó. Sólo en la copia persistida de quien comparte — nunca viaja en el link. */
  claimedBy?: string;
};

export function createContactInvite(
  fromName: string,
  inviterIdentityPublicKey: string,
  inviterWrapPublicKey: string,
  now: number = Date.now(),
): ContactInvite {
  return {
    fromName,
    token: toHex(Crypto.getRandomBytes(32)),
    inviterFingerprint: fingerprint(inviterIdentityPublicKey),
    inviterWrapPublicKey,
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

/** La tarjeta de una entrega, pero SIN el secreto en claro — va envuelto aparte, ver `ContactGrantMsg`. */
type ContactCardSinSecreto = Omit<ContactCard, 'contactSecret'>;

type ContactClaimMsg = {
  kind: 'claim';
  card: ContactCardSinSecreto;
  /**
   * `contactSecret` del reclamante, envuelto con X25519 a la pública de
   * envoltura de quien comparte (I1, cierre — revisión final de T-096 ·
   * ADR-015). `card.wrapPublicKey` es la pública de envoltura de QUIEN
   * RECLAMA — con ella quien comparte deriva el mismo secreto compartido para
   * abrir esto. Ver el comentario largo en `sealContactClaim`.
   */
  wrappedSecret: string;
};

/**
 * Lo que abre un reclamo válido: la tarjeta del reclamante SIN el secreto
 * (todavía envuelto). El llamador (`admitContactClaim`) es quien desenvuelve
 * `wrappedSecret` con su propia privada de envoltura — ver `sealContactClaim`.
 */
export type ContactClaim = { card: ContactCardSinSecreto; wrappedSecret: string };

type ContactGrantMsg = {
  kind: 'grant';
  card: ContactCardSinSecreto;
  /**
   * `contactSecret` del que comparte, envuelto con X25519 a la pública de
   * envoltura de ESE reclamante puntual (C2, hallazgo de la revisión final de
   * T-096). `card.wrapPublicKey` es la pública de quien envuelve — con ella el
   * receptor deriva el mismo secreto compartido para abrir esto. Ver el
   * comentario largo en `sealContactGrant`.
   */
  wrappedSecret: string;
  /** Para quién es. Con un link reenviado puede haber más de un reclamante; cada uno tiene el suyo. */
  forUserId: string;
  signedBy: string;
  signature: string;
};
type ContactInviteMessage = ContactClaimMsg | ContactGrantMsg;

/**
 * Lo que abre una entrega válida: la tarjeta SIN el secreto (todavía envuelto)
 * y para quién era. El llamador (`processContactInvite`) es quien desenvuelve
 * `wrappedSecret` con su propia privada de envoltura — ver `openContactGrant`.
 */
export type ContactGrant = { card: ContactCardSinSecreto; wrappedSecret: string; forUserId: string };

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

/** Validación de la tarjeta de una entrega o de un reclamo — los dos viajan SIN `contactSecret` (C2/I1). */
function tarjetaSinSecretoValida(card: unknown): card is ContactCardSinSecreto {
  const c = card as ContactCardSinSecreto;
  return Boolean(c) && c.kind === 'contact' && Boolean(c.userId) && Boolean(c.name)
    && Boolean(c.wrapPublicKey) && Boolean(c.identityPublicKey);
}

/**
 * Publica quién soy: mi propia `ContactCard`, sin firmar — el que comparte no
 * tiene de antemano nada contra qué verificarla (no hay firma posible: el que
 * comparte no tiene ninguna huella pre-establecida del reclamante contra la
 * cual verificarla, a diferencia del grant, que el reclamante SÍ puede
 * verificar contra `inviterFingerprint`).
 *
 * **CERRADO (I1, revisión final de T-096 · ADR-015):** antes esto sellaba la
 * tarjeta completa —con `contactSecret` del RECLAMANTE en claro— con la clave
 * simétrica derivada del token, la misma que puede calcular cualquiera que
 * tenga el link reenviado (no sólo quien lo compartió originalmente). Un
 * bystander con el mismo link —que nunca reclama nada, sólo lee el buzón—
 * podía leer el secreto permanente del reclamante exactamente igual que el
 * bystander de C2 podía leer el del que comparte antes de esa corrección.
 *
 * El cierre es el mismo mecanismo de C2, en la dirección inversa:
 * `ContactInvite` ahora lleva `inviterWrapPublicKey` (pública X25519 de
 * envoltura de quien comparte, información pública — viaja en el link a
 * propósito). El reclamante envuelve su `contactSecret` con X25519 a ESA
 * pública (`wrapGroupKey`), no sólo lo sella con la clave del token. Sin la
 * privada de quien comparte, `unwrapGroupKey` no recupera nada, aunque se
 * tenga el token y se pueda abrir el sobre exterior — igual que en
 * `sealContactGrant`.
 *
 * A diferencia del grant, un reclamo no lleva `forUserId` ni firma: sólo hay
 * un destinatario posible (quien generó la invitación), así que no hace
 * falta desambiguar entre varios — y no hay firma porque quien comparte no
 * tiene ninguna huella pre-establecida del reclamante para verificarla contra
 * algo (el reclamante, en cambio, SÍ puede verificar el grant contra
 * `inviterFingerprint`, que ya conocía por el link).
 */
export async function sealContactClaim(
  token: string,
  card: ContactCard,
  inviterWrapPublicKey: string,
  claimantWrapPrivateKey: string,
): Promise<string> {
  const { contactSecret, ...cardSinSecreto } = card;
  const wrappedSecret = wrapGroupKey(contactSecret, inviterWrapPublicKey, claimantWrapPrivateKey);
  return seal(token, { kind: 'claim', card: cardSinSecreto, wrappedSecret });
}

/**
 * Abre un reclamo. Cualquiera que tenga el token puede llamarla — abrir el
 * sobre exterior no prueba nada más que eso. **No desenvuelve `wrappedSecret`
 * acá** (mismo motivo que `openContactGrant`): quien llama (`admitContactClaim`)
 * es quien tiene la privada de envoltura correcta (la de quien comparte) para
 * desenvolver de verdad.
 */
export async function openContactClaim(token: string, sealed: string): Promise<ContactClaim | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'claim') return null;
  if (!tarjetaSinSecretoValida(msg.card) || !msg.wrappedSecret) return null;
  return { card: msg.card, wrappedSecret: msg.wrappedSecret };
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
function grantPayload(card: ContactCardSinSecreto, wrappedSecret: string, forUserId: string): string {
  return [card.userId, card.wrapPublicKey, card.identityPublicKey, wrappedSecret, forUserId].join('|');
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
 * Entrega mi tarjeta, firmada para un destinatario puntual — con mi secreto
 * permanente envuelto SÓLO para ese destinatario (C2, hallazgo de la revisión
 * final de T-096 · ADR-015).
 *
 * `forUserId`: con un link reenviado, el mismo buzón puede tener más de un
 * reclamo — el primero válido es el único que se admite, pero el sobre de la
 * entrega es público en ese tópico para cualquiera que tenga el token. Sin
 * destinatario, cualquier otro reclamante (admitido o no) sabría igual que
 * esta entrega existe. Mismo motivo que `forUserId` en `groupInvite.ts#InviteGrant`.
 *
 * `contactSecret` envuelto (C2): antes viajaba en claro dentro del sobre
 * sellado sólo con la clave simétrica del TOKEN — y esa clave la puede derivar
 * cualquiera que tenga el link, no sólo el destinatario admitido, porque el
 * link es justo lo único que hace falta para calcularla. `forUserId` no lo
 * evitaba: es un campo que un bystander hostil ignora al descifrar con su
 * propia copia de la clave del token — no es una puerta criptográfica, sólo
 * protege de que un cliente HONESTO se confunda de destinatario. Envolver el
 * secreto con X25519 a la pública de envoltura del reclamante puntual
 * (`claimantWrapPublicKey`, la que trae su `claim.wrapPublicKey`) es lo que sí
 * cierra el acceso: sin la privada de ESE reclamante, `unwrapGroupKey` no
 * recupera nada, aunque se tenga el token y se pueda abrir el sobre exterior.
 * Mismo patrón exacto que `groupInvite.ts#wrapGroupKey` para la clave de grupo.
 */
export async function sealContactGrant(
  token: string,
  card: ContactCard,
  forUserId: string,
  claimantWrapPublicKey: string,
  signingPrivateKey: string,
  senderWrapPrivateKey: string,
): Promise<string> {
  const { contactSecret, ...cardSinSecreto } = card;
  const wrappedSecret = wrapGroupKey(contactSecret, claimantWrapPublicKey, senderWrapPrivateKey);
  const signedBy = toHex(ed25519.getPublicKey(fromHex(signingPrivateKey)));
  const signature = toHex(
    ed25519.sign(utf8(grantPayload(cardSinSecreto, wrappedSecret, forUserId)), fromHex(signingPrivateKey)),
  );
  return seal(token, { kind: 'grant', card: cardSinSecreto, wrappedSecret, forUserId, signedBy, signature });
}

/**
 * Abre una entrega y verifica que la mandó quien dice el link. La clave del
 * token sola no alcanza: cualquiera que lo haya reenviado la conoce también —
 * es justo lo que este mecanismo está cerrando. La huella ata la entrega a la
 * identidad que el link prometió, y la firma prueba que quien la mandó tiene
 * esa privada. `forUserId` viaja DENTRO de lo firmado — ver `grantPayload` —
 * así que el llamador tiene que contrastarlo contra su propio id antes de
 * adoptar nada; acá sólo se verifica que el campo esté y no fue alterado.
 *
 * **No desenvuelve `wrappedSecret` acá** (C2): esta función la puede llamar
 * cualquiera que tenga el token, admitido o no — es sólo apertura + verificación
 * de firma, no prueba de destinatario. Quien llama (`processContactInvite`)
 * es quien ya validó `forUserId === miUserId` y tiene la privada de envoltura
 * correcta para desenvolver de verdad.
 */
export async function openContactGrant(
  token: string,
  sealed: string,
  expectedFingerprint: string,
): Promise<ContactGrant | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'grant') return null;
  if (!tarjetaSinSecretoValida(msg.card) || !msg.wrappedSecret || !msg.signedBy || !msg.signature || !msg.forUserId) {
    return null;
  }
  if (fingerprint(msg.signedBy) !== expectedFingerprint) return null;

  try {
    const ok = ed25519.verify(
      fromHex(msg.signature),
      utf8(grantPayload(msg.card, msg.wrappedSecret, msg.forUserId)),
      fromHex(msg.signedBy),
    );
    return ok ? { card: msg.card, wrappedSecret: msg.wrappedSecret, forUserId: msg.forUserId } : null;
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
    w: invite.inviterWrapPublicKey,
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
  const inviterWrapPublicKey = str(params.w) ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(inviterWrapPublicKey)) return null;
  const fromName = str(params.n) ?? '';
  if (fromName !== '' && !esNombreSeguro(fromName)) return null;

  return { fromName, token, inviterFingerprint, inviterWrapPublicKey, expiresAt: Number(expiresAt) };
}

export function parseContactInviteLink(link: string): ContactInvite | null {
  const r = rutaDeEnlace(link);
  if (!r || r.ruta !== 'contact/claim') return null;
  return contactInviteFromParams(Object.fromEntries(r.params.entries()));
}
