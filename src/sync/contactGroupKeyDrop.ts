import { ed25519 } from '@noble/curves/ed25519.js';
import { sealEnvelope, toHex, fromHex } from './envelopeCrypto';
import { sendEnvelope, type SendResult } from './relay';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { wrapGroupKey, unwrapGroupKey } from './groupInvite';
import { claveLocalVinoDeContacto, registrarOferta } from './groupKeyOffers';
import { getPeer } from './contactPeers';
import { deriveContactTopic, contactKey } from './contactTopic';

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
 * Entrega de la clave de un grupo a un contacto conocido (T-192: salió de
 * `contactChannel.ts`).
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

function dropPayload(d: Omit<GroupKeyDrop, 'kind' | 'signature'>): string {
  return [d.groupId, d.fromUserId, d.forUserId, d.wrappedKey, d.senderWrapPublicKey, d.epoch].join('|');
}

/**
 * Le manda a un contacto la clave de un grupo — versión que expone el motivo
 * del fallo (T-147 D4, ronda 2).
 *
 * `{ ok: false, reason: 'no_data' }` si no lo conocemos lo suficiente (sin
 * buzón o sin su pública) o si no tenemos la clave: en esos casos no hay nada
 * que entregar y reintentarlo no cambiaría nada. El resto de las razones son
 * las de `sendEnvelope` (`relay.ts`) — en particular `rate_limited`, que
 * `relayQueue` sabe reintentar solo (antes se perdía: `sendGroupKey` sólo
 * devolvía `boolean` y el motivo se descartaba).
 */
export async function sendGroupKeyResultado(
  peerUserId: string,
  group: { id: string; name: string },
  deviceId: string,
): Promise<SendResult | { ok: false; reason: 'no_data' | 'invalid_key'; detail?: string }> {
  const me = useAuthStore.getState().currentUser;
  const peer = getPeer(peerUserId);
  const record = useGroupKeyStore.getState().getKey(group.id);
  if (!me || !peer?.secret || !peer.wrapPublicKey || !record) return { ok: false, reason: 'no_data' };

  /**
   * Verifier R3-3(a): antes, armar `drop` (incluido `wrapGroupKey`) corría
   * FUERA de este `try`. Una `wrapPublicKey` corrupta que se coló al guardar
   * el contacto (`savePeerFromCard` ya la valida — segunda barrera) hacía
   * tirar `x25519` con un `RangeError` sin capturar. `relayQueue` trata
   * CUALQUIER excepción como `'reintentar'` — para un error permanente como
   * éste (la clave nunca deja de estar corrupta sola), eso era reintentar
   * para siempre (PoC: 901 veces en 1h, bloqueando a los trabajos sanos
   * detrás). Envuelto acá, se distingue como `'invalid_key'`, descartable.
   */
  try {
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

    const topic = await deriveContactTopic(peer.secret);
    const sealed = sealEnvelope(await contactKey(peer.secret), JSON.stringify(drop));
    return await sendEnvelope(topic, sealed, deviceId);
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, reason: 'invalid_key', detail: String(e) };
    return { ok: false, reason: 'network', detail: String(e) };
  }
}

/**
 * Le manda a un contacto la clave de un grupo.
 * `false` si no lo conocemos lo suficiente (sin buzón o sin su pública) o si
 * no tenemos la clave: en esos casos no hay nada que entregar.
 *
 * Envoltorio fino sobre `sendGroupKeyResultado` (mantenido por compatibilidad
 * — casi todos los llamadores sólo necesitan saber si salió).
 */
export async function sendGroupKey(
  peerUserId: string,
  group: { id: string; name: string },
  deviceId: string,
): Promise<boolean> {
  return (await sendGroupKeyResultado(peerUserId, group, deviceId)).ok;
}

/**
 * Registra como OFERTA una clave que llegó por el canal de contacto
 * (T-136 · ADR-013). Ya no adopta: eso se decide al final del lote, en
 * `resolverOfertas` (`contactChannel.ts`), mirando todas las ofertas del grupo.
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
export function registrarDropComoOferta(drop: GroupKeyDrop, myUserId: string): boolean {
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
