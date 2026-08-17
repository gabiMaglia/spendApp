import * as Crypto from 'expo-crypto';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { sealEnvelope, openEnvelope, toHex, fromHex } from './envelopeCrypto';
import { sendEnvelope, fetchSince } from './relay';

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
  email: string;
  /** Secreto de quien manda: es lo que deja el canal abierto en los dos sentidos. */
  contactSecret: string;
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
    email: me.email ?? '',
    contactSecret: secret,
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

export type DrainContactsResult = { added: number; cursor: number };

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
  if (!me || !mySecret) return { added: 0, cursor: sinceSeq };

  let topic: string;
  let key: Uint8Array;
  try {
    topic = await deriveContactTopic(mySecret);
    key = await contactKey(mySecret);
  } catch {
    return { added: 0, cursor: sinceSeq };
  }

  const r = await fetchSince(topic, sinceSeq, deviceId);
  if (!r.ok) return { added: 0, cursor: sinceSeq };

  let added = 0;
  for (const envelope of r.envelopes) {
    const card = parseCard(openEnvelope(key, envelope.payload));
    // Un sobre que no abre es basura de alguien que conoce el topic: se saltea
    // sin frenar la cola.
    if (!card || card.userId === me.id) continue;

    useUserStore.getState().addOrUpdateUser({
      id: card.userId,
      name: card.name,
      email: card.email,
      authProvider: 'google',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDeleted: false,
    });
    savePeerSecret(card.userId, card.contactSecret);
    added++;
  }

  return { added, cursor: r.cursor };
}

function parseCard(plain: string | null): ContactCard | null {
  if (plain === null) return null;
  try {
    const card = JSON.parse(plain) as ContactCard;
    if (card.kind !== 'contact' || !card.userId || !card.name) return null;
    return card;
  } catch {
    return null;
  }
}

// --- secretos de los contactos ------------------------------------------------
// Se guardan para poder avisarles cosas después sin volver a escanear nada.

const K_PEERS = 'contact_peers_v1';

export function savePeerSecret(userId: string, secret: string): void {
  if (!secret) return;
  const todos = listPeerSecrets();
  todos[userId] = secret;
  writeScoped(storage, K_PEERS, JSON.stringify(todos));
}

export function listPeerSecrets(): Record<string, string> {
  const raw = readScoped(storage, K_PEERS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {}; // dato corrupto: se degrada a "no conozco a nadie", no rompe
  }
}

export function peerSecret(userId: string): string | undefined {
  return listPeerSecrets()[userId];
}
