import * as Crypto from 'expo-crypto';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { avatarCabe } from '@/src/services/avatarSize';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { sealEnvelope, openEnvelope, toHex, fromHex } from './envelopeCrypto';
import { sendEnvelope, fetchSince } from './relay';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { wrapGroupKey, unwrapGroupKey } from './groupInvite';
import { ed25519 } from '@noble/curves/ed25519.js';
import { syncedNow } from '@/src/utils/syncedClock';
import {
  claveLocalVinoDeContacto, estado, marcarAdoptada, ofertasDe, registrarOferta,
} from './groupKeyOffers';

/** Bytes UTF-8 de un texto: `Buffer` no existe en React Native. */
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

const TOPIC_DOMAIN = 'splitp2p/contact/v1/topic';
const KEY_DOMAIN   = 'splitp2p/contact/v1';

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

/** Buzón de contacto de alguien, derivado de su secreto. */
export async function deriveContactTopic(secret: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${TOPIC_DOMAIN}:${secret}`);
}

/**
 * Clave que cifra lo que se deja en ese buzón.
 *
 * Dominio DISTINTO del topic a propósito: el topic viaja en claro hasta el
 * servidor, así que si los dos salieran de la misma derivación el servidor
 * tendría la clave y podría leer quién agrega a quién.
 */
async function contactKey(secret: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${KEY_DOMAIN}:${secret}`,
  );
  return fromHex(hex.slice(0, 64));
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
  const card = myContactCard();
  if (!card || !peerSecret) return false;

  try {
    const topic = await deriveContactTopic(peerSecret);
    const sealed = sealEnvelope(await contactKey(peerSecret), JSON.stringify(card));
    const r = await sendEnvelope(topic, sealed, deviceId);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Entrega de la clave de un grupo a un contacto conocido.
 *
 * Reemplaza al link para gente que ya escaneaste: creás el grupo y le llega,
 * sin que tenga que abrir nada ni escanear de nuevo.
 *
 * La clave va **envuelta para su X25519**, no sólo cifrada con la clave del
 * buzón. La diferencia importa: la clave del buzón la conoce TODO el que haya
 * escaneado ese código alguna vez, así que dejar ahí una clave de grupo en esas
 * condiciones se la estaría entregando a todos ellos.
 */
export type GroupKeyDrop = {
  kind: 'group_key';
  groupId: string;
  groupName: string;
  fromUserId: string;
  forUserId: string;
  wrappedKey: string;
  senderWrapPublicKey: string;
  /** Ed25519 de quien manda: se contrasta con la que guardamos de esa persona. */
  senderIdentity: string;
  epoch: number;
  sentAt: number;
  signature: string;
};

type ChannelMessage = ContactCard | GroupKeyDrop;

function dropPayload(d: Omit<GroupKeyDrop, 'kind' | 'signature'>): string {
  return [d.groupId, d.fromUserId, d.forUserId, d.wrappedKey, d.senderWrapPublicKey, d.epoch].join('|');
}

/**
 * Le manda a un contacto la clave de un grupo.
 * `false` si no lo conocemos lo suficiente (sin buzón o sin su pública) o si
 * no tenemos la clave: en esos casos no hay nada que entregar.
 */
export async function sendGroupKey(
  peerUserId: string,
  group: { id: string; name: string },
  deviceId: string,
): Promise<boolean> {
  const me = useAuthStore.getState().currentUser;
  const peer = getPeer(peerUserId);
  const record = useGroupKeyStore.getState().getKey(group.id);
  console.log('[DIAG sendGroupKey]', peerUserId, 'me=', !!me, 'peer.secret=', !!peer?.secret, 'peer.wrap=', !!peer?.wrapPublicKey, 'record=', !!record);
  if (!me || !peer?.secret || !peer.wrapPublicKey || !record) return false;

  const wrap = ensureWrapKeypair();
  const identity = ensureIdentity();

  const datos = {
    groupId: group.id,
    groupName: group.name,
    fromUserId: me.id,
    forUserId: peerUserId,
    wrappedKey: wrapGroupKey(record.key, peer.wrapPublicKey, wrap.privateKey),
    senderWrapPublicKey: wrap.publicKey,
    senderIdentity: identity.publicKey,
    epoch: record.epoch,
    sentAt: Date.now(),
  };

  const drop: GroupKeyDrop = {
    ...datos,
    kind: 'group_key',
    signature: toHex(ed25519.sign(utf8(dropPayload(datos)), fromHex(identity.privateKey))),
  };

  try {
    const topic = await deriveContactTopic(peer.secret);
    const sealed = sealEnvelope(await contactKey(peer.secret), JSON.stringify(drop));
    return (await sendEnvelope(topic, sealed, deviceId)).ok;
  } catch {
    return false;
  }
}

/**
 * Registra como OFERTA una clave que llegó por el canal de contacto
 * (T-136 · ADR-013). Ya no adopta: eso se decide al final del lote, en
 * `resolverOfertas`, mirando todas las ofertas del grupo.
 *
 * Se acepta SÓLO si viene de alguien que escaneamos y la firma corresponde a la
 * identidad que guardamos de esa persona. Sin este chequeo, cualquiera que
 * conozca el buzón (todos los que escanearon el mismo código) podría meter una
 * clave inventada.
 *
 * Lo que la firma NO prueba: que el remitente sea miembro del grupo. Por eso
 * una oferta sola nunca sustituye nada.
 *
 * `true` sólo si dejó una oferta nueva o cambiada: es lo que marca al grupo
 * para resolverlo en este lote.
 */
function registrarDropComoOferta(drop: GroupKeyDrop, myUserId: string): boolean {
  // Redundante con la criptografía —una entrega envuelta para otro no la puedo
  // abrir igual— y por eso ningún test puede matarlo. Se deja porque hace
  // explícita la intención y corta antes de gastar una operación de curva.
  if (drop.forUserId !== myUserId || drop.fromUserId === myUserId) return false;

  const peer = getPeer(drop.fromUserId);
  if (!peer?.identityPublicKey || peer.identityPublicKey !== drop.senderIdentity) return false;

  try {
    const { kind: _k, signature, ...datos } = drop;
    const ok = ed25519.verify(fromHex(signature), utf8(dropPayload(datos)), fromHex(drop.senderIdentity));
    if (!ok) return false;
  } catch {
    return false;
  }

  // El unwrap va ANTES de mirar la clave local (T-136): para saber si hay
  // conflicto hay que comparar claves. Destinatario y firma ya se verificaron.
  const wrap = ensureWrapKeypair();
  const key = unwrapGroupKey(drop.wrappedKey, drop.senderWrapPublicKey, wrap.privateKey);
  // Una clave del largo equivocado dejaría el grupo ilegible para siempre, sin
  // más síntoma que "no me llega nada".
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return false;

  const local = useGroupKeyStore.getState().getKey(drop.groupId);
  if (local) {
    if (local.key.toLowerCase() === key.toLowerCase()) return false; // ya la teníamos

    // T-132 criterio 4 (`qa/SEC3-2026-09-14.md`): esta guarda es la que hace
    // que S3-A1 NO se repita acá. Una clave local de `ensureKey`, QR o
    // invitación no deja ni oferta ni aviso, y `drop.epoch` no se mira para
    // nada: no hay sustitución posible. Ver `contactChannel.test.ts` — "una
    // época absurda en el mensaje NO alcanza para sustituir una clave que ya
    // tenemos". Sólo una clave que vino de contacto puede entrar en disputa, y
    // aun así la decide el usuario (`elegirClaveDeGrupo`).
    if (!claveLocalVinoDeContacto(drop.groupId)) return false;
  }

  return registrarOferta({
    groupId: drop.groupId,
    fromUserId: drop.fromUserId,
    key: key.toLowerCase(),
    epoch: drop.epoch,
    origen: 'contact',
    receivedAt: Date.now(),
    adoptada: false,
  });
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
      const esNuevo = Boolean(msg.wrapPublicKey) && !previo?.wrapPublicKey;

      savePeerFromCard(msg.userId, {
        secret: msg.contactSecret,
        wrapPublicKey: msg.wrapPublicKey,
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

// --- registro de contactos ----------------------------------------------------
// De cada persona que escaneamos (o que nos escaneó) guardamos su buzón y sus
// claves públicas. Es lo que permite mandarle cosas después sin volver a
// vernos la cara — y, sobre todo, verificar que lo que llega es realmente suyo.

const K_PEERS = 'contact_peers_v1';
const K_CARD_SENT = 'card_sent_v1';

export type PeerInfo = {
  secret: string;
  /** X25519: a ella se le envuelven las claves de grupo. */
  wrapPublicKey?: string;
  /** Ed25519: con ella se verifica que lo que llega lo mandó esta persona. */
  identityPublicKey?: string;
};

/**
 * Guarda a alguien que tenemos DELANTE: su código lo estamos viendo en su
 * pantalla. Acá sí se pisa lo que hubiera antes — si reinstaló la app y tiene
 * claves nuevas, escanear de nuevo es exactamente cómo se re-verifica.
 *
 * **El gate vive en quien llama, no acá** (T-093 / SEC H-1): un link no es
 * "tenerlo delante", y un QR tampoco alcanza si ya había una clave pinneada
 * distinta (ni siquiera si el contacto está borrado). `app/contact/add.tsx`
 * llama primero a `hasConflictingPinnedKeys` y sólo invoca esta función
 * cuando no hay conflicto — a propósito se deja la función pisando siempre
 * que se la llama, porque otros caminos ya verificaron eso antes.
 */
export function savePeer(userId: string, info: PeerInfo): void {
  if (!info.secret) return;
  const todos = listPeers();
  // Los campos vacíos no borran lo que ya sabíamos: un código viejo sin claves
  // no debe hacernos perder las que ya teníamos.
  todos[userId] = { ...todos[userId], ...limpiar(info) };
  writeScoped(storage, K_PEERS, JSON.stringify(todos));
}

/**
 * Guarda a alguien a partir de una tarjeta que llegó por el relay.
 *
 * **Sólo completa huecos, nunca reemplaza una clave que ya teníamos.** La
 * diferencia con `savePeer` es de confianza y es la más importante del módulo:
 * una tarjeta la puede escribir cualquiera que conozca el buzón — es decir,
 * cualquiera que haya escaneado ese código alguna vez. Si pudiera pisar claves,
 * uno de ellos mandaría una tarjeta diciendo ser otra persona, con SUS claves, y
 * a partir de ahí le entregaríamos claves de grupo creyendo que es quien dice.
 *
 * Consecuencia deliberada: si alguien reinstala la app, hay que volver a
 * escanearlo. Verificar en persona significa eso; aceptar la clave nueva por el
 * mismo canal que se quiere proteger no verificaría nada.
 */
export function savePeerFromCard(userId: string, info: PeerInfo): void {
  if (!info.secret) return;
  const todos = listPeers();
  const previo = todos[userId];

  todos[userId] = {
    secret:            previo?.secret            ?? info.secret,
    wrapPublicKey:     previo?.wrapPublicKey     ?? info.wrapPublicKey,
    identityPublicKey: previo?.identityPublicKey ?? info.identityPublicKey,
  };
  writeScoped(storage, K_PEERS, JSON.stringify(todos));
}

/** Saca los campos vacíos, para que no pisen datos buenos al mezclar. */
function limpiar(info: PeerInfo): PeerInfo {
  return Object.fromEntries(
    Object.entries(info).filter(([, v]) => Boolean(v)),
  ) as PeerInfo;
}

/**
 * Huella de lo que al otro lado le importa de mi tarjeta.
 *
 * `sentAt` y `contactSecret` quedan AFUERA a propósito: el primero cambia en
 * cada llamada y haría que todo arranque pareciera un cambio, que es justo lo
 * que esto evita.
 */
export function cardFingerprint(card: ContactCard): string {
  // La foto entra en la huella: si no, cambiarla no se detectaría como un
  // cambio de tarjeta y no se reenviaría a nadie — exactamente el mecanismo
  // por el que hoy se propaga el nombre.
  return [
    card.userId, card.name,
    card.wrapPublicKey, card.identityPublicKey, card.avatar ?? '',
  ].join('|');
}

function tarjetasEnviadas(): Record<string, string> {
  const raw = readScoped(storage, K_CARD_SENT);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {}; // dato corrupto: se reenvía de más, nunca de menos
  }
}

/** ¿Este contacto ya tiene ESTA versión de mi tarjeta? */
export function cardYaEnviada(userId: string, huella: string): boolean {
  return tarjetasEnviadas()[userId] === huella;
}

/**
 * Se marca SÓLO cuando el envío salió bien. Es lo que hace que un fallo de red
 * se reintente al próximo arranque en vez de perderse: el modo de falla que
 * teníamos era exactamente ese, y en silencio.
 */
export function marcarCardEnviada(userId: string, huella: string): void {
  const todas = tarjetasEnviadas();
  todas[userId] = huella;
  writeScoped(storage, K_CARD_SENT, JSON.stringify(todas));
}

export function listPeers(): Record<string, PeerInfo> {
  // Prototipo nulo: los ids vienen de afuera, y `getPeer('constructor')` devolvía
  // `Function` (T-098 · SEC L-3). Ojo con nombrar la otra forma de hacer esto
  // acá arriba: el guard de `accountCoverage.test.ts` la toma como "esto cachea
  // en memoria" (heurística pensada para el `create` de zustand), y este objeto
  // es efímero — no hay nada que soltar al cambiar de cuenta.
  const tabla: Record<string, PeerInfo> = Object.setPrototypeOf({}, null);
  const raw = readScoped(storage, K_PEERS);
  if (!raw) return tabla;
  try {
    return Object.assign(tabla, JSON.parse(raw) as Record<string, PeerInfo>);
  } catch {
    return tabla; // dato corrupto: se degrada a "no conozco a nadie", no rompe
  }
}

export function getPeer(userId: string): PeerInfo | undefined {
  return listPeers()[userId];
}

/**
 * ¿Lo que llegó (QR o link) pisaría una clave que ya teníamos pinneada?
 *
 * De sólo lectura: no persiste nada. Es el gate que `app/contact/add.tsx`
 * corre ANTES de `savePeer`, para los dos orígenes por igual (T-093 / SEC
 * H-1). Sin peer previo, o si el previo no tenía esa clave todavía, no hay
 * nada que pisar — completar un hueco no es un conflicto. El peer sobrevive
 * al borrado (tombstone) del contacto en `userStore` (`removeUser` no lo
 * toca), así que esto también protege a un contacto ya borrado.
 */
export function hasConflictingPinnedKeys(userId: string, incoming: PeerInfo): boolean {
  const previo = getPeer(userId);
  if (!previo) return false;

  const distinta = (a?: string, b?: string) => Boolean(a) && Boolean(b) && a !== b;
  return distinta(previo.identityPublicKey, incoming.identityPublicKey)
      || distinta(previo.wrapPublicKey, incoming.wrapPublicKey);
}

export function peerSecret(userId: string): string | undefined {
  return getPeer(userId)?.secret;
}
