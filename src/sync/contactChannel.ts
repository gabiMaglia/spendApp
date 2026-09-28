import * as Crypto from 'expo-crypto';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { avatarCabe } from '@/src/services/avatarSize';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { sealEnvelope, openEnvelope, toHex } from './envelopeCrypto';
import { sendEnvelope, fetchSince, type SendResult } from './relay';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { estado, marcarAdoptada, ofertasDe } from './groupKeyOffers';
import { getPeer, savePeerFromCard, listPeers, exportarPeers, restaurarPeers, type PeerInfo } from './contactPeers';
import { deriveContactTopic, contactKey } from './contactTopic';
import { type GroupKeyDrop, registrarDropComoOferta } from './contactGroupKeyDrop';

/**
 * Verifier R3-3(a): `wrapPublicKey` es una clave pública x25519 — 32 bytes,
 * 64 caracteres hex. `fromHex` (`hexBytes.ts`) NO valida nada: un string
 * corto o con caracteres no-hex produce un `Uint8Array` de largo distinto
 * (o con bytes `NaN`), y recién explota más tarde, dentro de
 * `x25519.getSharedSecret` (`wrapGroupKey`), con un `RangeError` — el PoC del
 * verifier lo reprodujo así. Un contacto puede envenenar esto mandando
 * cualquier string en `wrapPublicKey` de su tarjeta; validar ACÁ, al
 * guardarla, es la primera barrera (la segunda es el `try/catch` de
 * `sendGroupKeyResultado`).
 */
export function esWrapPublicKeyValida(hex: unknown): hex is string {
  return typeof hex === 'string' && /^[0-9a-f]{64}$/i.test(hex);
}

/**
 * Buzón de contactos: lo que hace que agregar a alguien quede en LOS DOS
 * teléfonos.
 *
 * Hasta acá el QR era de una sola dirección — quien escaneaba guardaba al otro,
 * y el que mostraba el código no se enteraba de nada. Eso obligaba a escanear
 * dos veces, uno en cada sentido, y era la queja principal del producto.
 *
 * Cómo se cierra: cada cuenta tiene un **secreto de contacto** propio que viaja
 * dentro de su QR. De ese secreto salen dos cosas distintas, con dominios
 * separados:
 *
 *  - el **topic** de su buzón (lo que el servidor ve), y
 *  - la **clave** que cifra lo que se deja ahí (lo que el servidor no puede
 *    calcular).
 *
 * Quien escanea el código puede entonces dejarle su propia tarjeta cifrada, y
 * el otro la recoge sola. Un escaneo, contacto en los dos lados.
 *
 * El secreto se muestra en pantalla, no se publica: sólo lo tiene quien estuvo
 * físicamente delante del código. Es el mismo modelo de confianza que ya tenía
 * el QR, sin agregarle nada.
 *
 * La tarjeta que se devuelve incluye el secreto del que escanea, así que el
 * canal queda **mutuo**: desde ese momento los dos pueden avisarse cosas sin
 * volver a verse la cara (es lo que va a necesitar la invitación a grupos entre
 * contactos conocidos, T-035).
 */

const storage = createSecureStorage('users');
const K_SECRET = 'contact_secret_v1';

/**
 * Secreto de contacto de la cuenta activa. Estable: si cambiara en cada
 * arranque, los códigos que ya mostró dejarían de funcionar.
 */
export function ensureContactSecret(): string | null {
  if (!useAuthStore.getState().currentUser) return null;

  const existente = readScoped(storage, K_SECRET);
  if (existente) return existente;

  const fresco = toHex(Crypto.getRandomBytes(32));
  writeScoped(storage, K_SECRET, fresco);
  return fresco;
}

/**
 * Todo el canal de contactos de la cuenta activa, para el backup completo
 * (T-213): el secreto PROPIO (`K_SECRET`), en claro, igual que el resto del
 * archivo (`export_warning_body` ya avisa) — más los peers y el acuse de
 * tarjeta, delegados a `contactPeers.ts` para no repetir sus claves `K_`.
 */
export function exportarContactos(): { secret: string | null; peers: Record<string, PeerInfo>; cardSent: Record<string, string> } {
  const { peers, cardSent } = exportarPeers();
  return { secret: readScoped(storage, K_SECRET) ?? null, peers, cardSent };
}

/**
 * Restaura el canal de contactos completo — secreto propio + peers + acuse.
 * Sólo tiene sentido llamarla para un backup PROPIO: `applyBackup` es quien
 * decide eso (gate por `esYo(ownerId)`), este módulo no lo verifica de
 * nuevo. Un `secret` ausente (backup v1/v2, o una cuenta que nunca mostró
 * su QR) no borra el que ya hubiera — mismo criterio que el resto de este
 * archivo con datos parciales.
 */
export function restaurarContactos(data: { secret: string | null; peers: Record<string, PeerInfo>; cardSent: Record<string, string> }): void {
  if (data.secret) writeScoped(storage, K_SECRET, data.secret);
  restaurarPeers(data.peers, data.cardSent);
}

export type ContactCard = {
  kind: 'contact';
  userId: string;
  name: string;
  /**
   * Sin `email` a propósito (T-093 / SEC H-1): esta tarjeta la recibe
   * cualquiera que conozca el buzón —incluido quien mandó un link hostil—, y
   * nadie del lado receptor necesita el mail de un contacto para nada. Antes
   * viajaba acá y contradecía la fila de Data Safety (`plans/T-077.md`), que
   * ya declaraba "no recolectado".
   */
  /** Secreto de quien manda: es lo que deja el canal abierto en los dos sentidos. */
  contactSecret: string;
  /** X25519 de su dispositivo: a ella se le envolverán las claves de grupo. */
  wrapPublicKey: string;
  /** Ed25519 de su dispositivo: con ella se verifica lo que mande después. */
  identityPublicKey: string;
  /**
   * Foto de perfil como data URI, ya achicada. Opcional: quien no tiene, viaja
   * sin ella y del otro lado se ven las iniciales.
   *
   * Va como BYTES y no como URL para no delegar en el CDN de nadie quién mira
   * a quién. El tope de `AVATAR_MAX_BYTES` existe porque esta tarjeta viaja en
   * cada sync: sin él, una foto de teléfono degradaría la sincronización de
   * todo el grupo.
   */
  avatar?: string;
  sentAt: number;
};

/** Tarjeta de la cuenta activa. `null` si no hay sesión. */
export function myContactCard(): ContactCard | null {
  const me = useAuthStore.getState().currentUser;
  const secret = ensureContactSecret();
  if (!me || !secret) return null;

  return {
    kind: 'contact',
    userId: me.id,
    name: me.name,
    // Se revalida el tope acá y no solo al guardar: es el último punto antes
    // de que la foto salga al aire.
    avatar: me.avatar && avatarCabe(me.avatar) ? me.avatar : undefined,
    contactSecret: secret,
    wrapPublicKey: ensureWrapKeypair().publicKey,
    identityPublicKey: ensureIdentity().publicKey,
    sentAt: Date.now(),
  };
}

/**
 * Deja mi tarjeta en el buzón del que acabo de escanear.
 *
 * No puede tirar: si falla, el contacto ya quedó guardado de este lado y el
 * único costo es que el otro tenga que escanear también. Romper el escaneo por
 * un problema de red sería mucho peor.
 */
export async function announceContact(peerSecret: string, deviceId: string): Promise<boolean> {
  return (await announceContactResultado(peerSecret, deviceId)).ok;
}

/**
 * Igual que `announceContact`, pero exponiendo el motivo del fallo (T-147
 * R4-2) — para que `relayQueue` pueda distinguir `rate_limited` (se
 * reintenta con el ritmo de la cuota, nunca se pierde) de un fallo real.
 */
async function announceContactResultado(
  peerSecret: string,
  deviceId: string,
): Promise<SendResult | { ok: false; reason: 'no_data' }> {
  return announceCardResultado(myContactCard(), peerSecret, deviceId);
}

/**
 * Igual que `announceContactResultado`, pero con la tarjeta YA ARMADA —
 * T-147 (punto 4 de la simplificación): un trabajo diferido de `relayQueue`
 * (`anunciarMiTarjeta`) tiene que mandar la tarjeta de la cuenta que estaba
 * activa AL ENCOLAR, no la que `myContactCard()` devolvería recién al
 * ejecutarse (que puede ser de OTRA cuenta, si hubo un cambio de cuenta en
 * el medio) — armarla adentro del trabajo diferido era exactamente el
 * agujero que dejaba salir datos de la cuenta anterior con la sesión nueva.
 */
export async function announceCardResultado(
  card: ContactCard | null,
  peerSecret: string,
  deviceId: string,
): Promise<SendResult | { ok: false; reason: 'no_data' }> {
  if (!card || !peerSecret) return { ok: false, reason: 'no_data' };

  try {
    const topic = await deriveContactTopic(peerSecret);
    const sealed = sealEnvelope(await contactKey(peerSecret), JSON.stringify(card));
    return await sendEnvelope(topic, sealed, deviceId);
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e) };
  }
}

export type DrainContactsResult = {
  added: number;
  /** Grupos cuya clave adoptamos: el llamador tiene que drenarlos. */
  joinedGroups: string[];
  /**
   * Grupos con claves DISTINTAS de remitentes distintos (T-136). No se adoptó
   * ni se sustituyó nada: el llamador avisa y decide el usuario.
   */
  conflictedGroups: string[];
  /** Nombre que traía el drop de cada grupo en conflicto. SIN VERIFICAR: lo escribe el remitente. */
  nombresDeDrop: Record<string, string>;
  cursor: number;
};

function sinNovedades(cursor: number): DrainContactsResult {
  return { added: 0, joinedGroups: [], conflictedGroups: [], nombresDeDrop: {}, cursor };
}

/**
 * Decide, grupo por grupo, qué hacer con las ofertas nuevas de este lote (T-136).
 *
 *  - Todas iguales y sin clave local → se adopta: el camino feliz de siempre.
 *  - Distintas entre sí, o contra la local que vino de contacto → no se adopta
 *    ni se sustituye nada; el grupo vuelve como conflicto.
 *
 * Al final del lote y no dentro del loop, a propósito: si Mallory y Beto mandan
 * claves distintas en el mismo drenaje, adoptar la primera sería exactamente el
 * «primero en llegar gana» que este ticket cierra.
 */
function resolverOfertas(grupos: string[]): { joinedGroups: string[]; conflictedGroups: string[] } {
  const joinedGroups: string[] = [];
  const conflictedGroups: string[] = [];

  for (const groupId of grupos) {
    const local = useGroupKeyStore.getState().getKey(groupId);
    const ofertas = ofertasDe(groupId);
    const est = estado(groupId, local?.key);

    if (est === 'conflicto') {
      conflictedGroups.push(groupId);
      continue;
    }
    if (est !== 'unanime' || local) continue;

    const epoch = Math.max(...ofertas.map(o => o.epoch));
    useGroupKeyStore.getState().adoptKeys([{ groupId, key: ofertas[0]!.key, epoch }]);
    for (const o of ofertas) marcarAdoptada(groupId, o.fromUserId);
    joinedGroups.push(groupId);
  }

  return { joinedGroups, conflictedGroups };
}

/**
 * Recoge las tarjetas que dejaron en MI buzón y las guarda como contactos.
 *
 * El cursor lo administra el llamador: este módulo no sabe nada de persistencia
 * del motor de sync, y así no se acopla al relay.
 */
export async function drainContacts(
  mySecret: string,
  deviceId: string,
  sinceSeq: number,
): Promise<DrainContactsResult> {
  const me = useAuthStore.getState().currentUser;
  if (!me || !mySecret) return sinNovedades(sinceSeq);

  let topic: string;
  let key: Uint8Array;
  try {
    topic = await deriveContactTopic(mySecret);
    key = await contactKey(mySecret);
  } catch {
    return sinNovedades(sinceSeq);
  }

  const r = await fetchSince(topic, sinceSeq, deviceId);
  if (!r.ok) return sinNovedades(sinceSeq);

  let added = 0;
  /** Buzones a los que hay que devolverles nuestra tarjeta. Ver abajo. */
  const responder: string[] = [];
  /** Grupos con una oferta nueva en ESTE lote, con el nombre con que llegó. */
  const conOfertaNueva = new Map<string, string>();

  for (const envelope of r.envelopes) {
    // Un sobre que no abre es basura de alguien que conoce el topic: se saltea
    // sin frenar la cola.
    const msg = parseMessage(openEnvelope(key, envelope.payload));
    if (!msg) continue;

    if (msg.kind === 'contact') {
      if (msg.userId === me.id) continue;
      useUserStore.getState().addOrUpdateUser({
        id: msg.userId,
        name: msg.name,
        // La tarjeta ya no trae email (T-093 / SEC H-1): se conserva el que ya
        // hubiera localmente en vez de pisarlo con vacío.
        email: useUserStore.getState().getUserById(msg.userId)?.email ?? '',
        avatar: msg.avatar,
        authProvider: 'google',
        createdAt: Date.now(),
        updatedAt: syncedNow(),
        isDeleted: false,
      });
      // Si de esta persona todavía no teníamos sus públicas y ahora sí, le
      // devolvemos la nuestra. Es lo que repara los contactos creados con una
      // versión anterior del código, que viajaba sin ellas: los dos lados se
      // completan solos al abrir la app, sin volver a escanear nada.
      //
      // No hay ping-pong: sólo se responde cuando la tarjeta trae algo que no
      // teníamos, así que a la segunda vuelta ya nadie responde.
      const previo = getPeer(msg.userId);
      // R3-3(a): una `wrapPublicKey` inválida NUNCA se guarda — se trata
      // como si la tarjeta no la trajera. Sin esto, quedaría persistida y
      // envenenaría cada intento futuro de mandarle la clave de un grupo.
      const wrapPublicKeyValida = esWrapPublicKeyValida(msg.wrapPublicKey) ? msg.wrapPublicKey : undefined;
      const esNuevo = Boolean(wrapPublicKeyValida) && !previo?.wrapPublicKey;

      savePeerFromCard(msg.userId, {
        secret: msg.contactSecret,
        wrapPublicKey: wrapPublicKeyValida,
        identityPublicKey: msg.identityPublicKey,
      });
      if (esNuevo) responder.push(msg.contactSecret);
      added++;
      continue;
    }

    if (registrarDropComoOferta(msg, me.id)) conOfertaNueva.set(msg.groupId, msg.groupName);
  }

  const { joinedGroups, conflictedGroups } = resolverOfertas([...conOfertaNueva.keys()]);
  const nombresDeDrop = Object.fromEntries(
    conflictedGroups.map(groupId => [groupId, conOfertaNueva.get(groupId) ?? '']),
  );

  for (const secreto of responder) await announceContact(secreto, deviceId);

  return { added, joinedGroups, conflictedGroups, nombresDeDrop, cursor: r.cursor };
}

/**
 * Contactos de los que tenemos buzón pero NO sus claves públicas.
 *
 * Son los que quedaron a medias: se agregaron con una versión que no las
 * mandaba. Sin sus públicas no se les puede entregar la clave de un grupo, y el
 * síntoma es el peor posible — el grupo simplemente no les llega, sin error.
 */
export function peersIncompletos(): string[] {
  return Object.entries(listPeers())
    .filter(([, info]) => info.secret && !info.wrapPublicKey)
    .map(([, info]) => info.secret);
}

type ChannelMessage = ContactCard | GroupKeyDrop;

function parseMessage(plain: string | null): ChannelMessage | null {
  if (plain === null) return null;
  try {
    const msg = JSON.parse(plain) as ChannelMessage;
    if (msg.kind === 'contact') return msg.userId && msg.name ? msg : null;
    if (msg.kind === 'group_key') return msg.groupId && msg.wrappedKey ? msg : null;
    return null;
  } catch {
    return null;
  }
}


// T-192: el registro de contactos (peers, tarjetas ya enviadas) salió a
// contactPeers.ts; la entrega de clave de grupo por contacto a
// contactGroupKeyDrop.ts; la derivación de topic/clave a contactTopic.ts.
// Re-exportado para que la ruta pública no cambie.
export {
  type PeerInfo, savePeer, savePeerFromCard, cardFingerprint, cardYaEnviada,
  marcarCardEnviada, listPeers, getPeer, hasConflictingPinnedKeys, peerSecret,
} from './contactPeers';
export {
  type GroupKeyDrop, sendGroupKeyResultado, sendGroupKey,
} from './contactGroupKeyDrop';
export { deriveContactTopic, contactKey } from './contactTopic';
