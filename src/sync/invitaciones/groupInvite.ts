import { ed25519 } from '@noble/curves/ed25519.js';
import * as Crypto from 'expo-crypto';
import { enlaceCompacto, enlaceCompartible, rutaDeEnlace } from '@/src/utils/appLink';
import { esIdDeCuenta } from '@/src/utils/idDeCuenta';
import { codificarInvitacion, decodificarInvitacion, RE_UUID } from '@/src/utils/linkCompacto';
import { esNombreSeguro, limpiarNombre } from '@/src/utils/nombreSeguro';
import { recordError } from '@/src/services/errorLog';
import { sealEnvelope, openEnvelope } from '@/src/sync/nucleo/envelopeCrypto';
import { toHex, fromHex } from '@/src/sync/nucleo/hexBytes';

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
  /**
   * Quién ya canjeó esta invitación (T-096 · ADR-015). Sólo en la copia
   * persistida de quien invita — nunca se codifica en el link.
   */
  claimedBy?: string;
  /**
   * Wrap pública (X25519) con la que `claimedBy` reclamó por primera vez
   * (T-151 · SEC-06). Ata el reintento al MISMO reclamante: si vuelve a
   * verse el mismo `claimedBy` con esta misma wrap, es él reintentando —el
   * envío anterior se perdió— y se re-entrega aunque ya figure como miembro.
   * Con otra wrap, no es él: es alguien más con el link.
   *
   * Opcional, pero NO retrocompatible en el sentido de "se comporta como
   * antes de T-151" (observación O2, verificador ronda 2): un canje hecho con
   * un build viejo (sin este campo) cuya entrega falló, y cuyo reintento ya
   * corre en un build con T-151, NO se re-entrega — cae al chequeo de lo
   * pinneado (`getPeer`) y lo rechaza, porque un invitado nuevo nunca pasó por
   * ahí. Antes de T-151 sí se re-entregaba (no había chequeo de miembro en
   * `admit`). Es un caso residual, acotado por el TTL de 48hs de la
   * invitación, y falla cerrado — la opción segura frente a re-entregar sin
   * poder confirmar que es el mismo reclamante.
   */
  claimedWrapKey?: string;
  /**
   * `Date.now()` del PRIMER reclamo publicado (T-172, ítem 2 — ronda 2/5).
   * Sólo tiene sentido en la copia PENDIENTE (lado del que reclama,
   * `K_PENDING`) — la de quien invita nunca lo toca. Se estampa una sola vez
   * en `savePendingJoin` y sobrevive a reclamos repetidos del mismo token
   * (reintentos manuales, `processAllInvites` en cada sync): es el ancla de
   * tiempo contra la que se mide si el ingreso se demoró demasiado. Vive en
   * la MISMA entrada persistida en vez de un storage aparte: se borra sola
   * cuando el join se resuelve (`removePendingJoin`) o expira, sin nada
   * extra que limpiar.
   *
   * Reemplaza al contador de intentos de la ronda 1 (D1 del verificador):
   * contar LLAMADAS a `processInvite` confundía "sin respuesta" con "el loop
   * interactivo de `join.tsx` sondeó varias veces en pocos segundos".
   */
  firstAttemptAt?: number;
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

/** Link para compartir por cualquier canal. Es `https` y no `spendapp://`: ver `utils/appLink`. */
export function inviteToLink(invite: GroupInvite): string {
  // Compacto si la regla lo puede representar sin pérdida; si no, el largo (`linkCompacto`).
  const codigo = codificarInvitacion(invite);
  if (codigo) return enlaceCompacto('g', codigo);

  const params = new URLSearchParams({
    g: invite.groupId,
    n: limpiarNombre(invite.groupName),
    t: invite.token,
    f: invite.inviterFingerprint,
    e: String(invite.expiresAt),
  });
  return enlaceCompartible('groups/join', params);
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

  // Formato compacto: todo viene en `c`, y manda sobre cualquier otro parámetro.
  const codigo = str(params.c);
  if (codigo !== undefined) return decodificarInvitacion(codigo);

  const groupId = str(params.g), token = str(params.t), expiresAt = str(params.e);
  if (!groupId || !token || !expiresAt) return null;
  // Validado como el compacto (T-098 · SEC L-2): antes pasaban `t=tok` y `e=1e308`.
  // T-124 · SEC L-B: `groupId` sin forma pasaba entero — todo groupId real es
  // un UUID generado en el dispositivo (regla de negocio #5).
  if (!RE_UUID.test(groupId)) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(token)) return null;
  if (!/^\d{1,15}$/.test(expiresAt) || Number(expiresAt) > 2 ** 48 - 1) return null;
  const inviterFingerprint = str(params.f) ?? '';
  if (inviterFingerprint !== '' && !/^[0-9a-fA-F]{32}$/.test(inviterFingerprint)) return null;
  const groupName = str(params.n) ?? '';
  if (groupName !== '' && !esNombreSeguro(groupName)) return null;

  return { groupId, groupName, token, inviterFingerprint, expiresAt: Number(expiresAt) };
}

export function parseInviteLink(link: string): GroupInvite | null {
  const r = rutaDeEnlace(link);
  if (!r || r.ruta !== 'groups/join') return null;
  return inviteFromParams(Object.fromEntries(r.params.entries()));
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
  // T-151 (SEC-06): el `userId` entra al roster y a los repartos tal cual. La
  // misma forma que exige un link de contacto (T-124): un id armado a mano
  // (`__proto__`, NUL, `../x`) no calza.
  if (!esIdDeCuenta(msg.userId)) {
    // D3 (T-151): rechazo por seguridad con rastro — sin la clave completa,
    // sólo el motivo, para poder diagnosticar sin filtrar datos sensibles.
    recordError({ message: 'openClaim_rechazado: id_forma_invalida', fatal: false, screen: 'sync.invite' });
    return null;
  }
  // O3 (T-151, ronda 2): normalizar UNA sola vez acá, y usar siempre este
  // valor — para comparar contra lo pinneado, para envolver (`wrapGroupKey`)
  // y para persistir (`claimedWrapKey`). Antes, `admit` sólo normalizaba para
  // COMPARAR (`toLowerCase` ad hoc) pero envolvía con el hex crudo del claim:
  // un wrap en mayúsculas pasaba la comparación pero quedaba envuelto hacia
  // un `info` HKDF (`deriveWrapKey`) distinto del que deriva `unwrapGroupKey`
  // desde la clave privada real (que siempre sale en minúsculas de `toHex`)
  // — ni el dueño legítimo podía abrir el grant, y el link quedaba gastado.
  return {
    ...msg,
    wrapPublicKey: msg.wrapPublicKey.toLowerCase(),
    identityPublicKey: msg.identityPublicKey.toLowerCase(),
  };
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


// T-192: la envoltura de la clave de grupo (X25519 + HKDF) salió a
// groupKeyWrap.ts. Re-exportado para que la ruta pública no cambie — los
// tres tienen consumidores de producción reales (inviteEngine.ts,
// contactInvite.ts, identityStore.ts, etc.).
//
// T-206-A (D9): `V1_ACEPTADO_HASTA` salió de esta lista — sin consumidores
// de producción, sólo la usaba `groupInvite.test.ts`, migrado a importarla
// de `groupKeyWrap.ts` directo.
export { wrapGroupKey, unwrapGroupKey, generateWrapKeypair } from './groupKeyWrap';
