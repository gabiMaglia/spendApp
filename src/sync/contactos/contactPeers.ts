import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import type { ContactCard } from './contactChannel';

/**
 * Registro de contactos — salió de `contactChannel.ts` (T-192) para bajarlo
 * de 713 líneas. De cada persona que escaneamos (o que nos escaneó)
 * guardamos su buzón y sus claves públicas. Es lo que permite mandarle
 * cosas después sin volver a vernos la cara — y, sobre todo, verificar que
 * lo que llega es realmente suyo.
 */

const storage = createSecureStorage('users');
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
