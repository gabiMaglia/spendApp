import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import {
  ensureIdentity, ensureWrapKeypair,
  savePendingJoin, removePendingJoin, listInvites, listPendingJoins,
} from '@/src/store/identityStore';
import { publishToGroup } from './relaySync';
import { sendEnvelope, fetchSince } from './relay';
import {
  deriveInviteTopic, sealClaim, openClaim, sealGrant, openGrant,
  wrapGroupKey, unwrapGroupKey, isInviteExpired,
  type GroupInvite, type InviteClaim, type InviteGrant,
} from './groupInvite';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * El encuentro entre quien invita y quien entra.
 *
 * Los dos lados usan el MISMO buzón, derivado del token que viajó en el link.
 * El invitado publica su reclamo; el que invita lo lee, lo suma al grupo y le
 * devuelve la clave envuelta para su clave pública. Recién con esa clave el
 * invitado puede leer el buzón del grupo — es decir, **entregar la clave es
 * admitir**, no hay un paso de aprobación aparte (ADR-003, enmienda T-034).
 *
 * Tres decisiones que no son obvias:
 *
 *  - **Se lee siempre desde el principio del buzón, sin cursor.** Es un buzón
 *    chico y con vencimiento (48hs); a cambio, todo el flujo queda idempotente
 *    y se cura solo: si un sobre se procesó a medias, el siguiente intento lo
 *    vuelve a ver. Un cursor acá ahorraría bytes y compraría un bug silencioso.
 *  - **El estado del grupo se publica ANTES de entregar la clave.** Si fuera al
 *    revés, el invitado podría descifrar el buzón del grupo justo cuando todavía
 *    está vacío, quedarse sin el grupo y no tener nada que lo dispare de nuevo.
 *  - **Nada de esto puede tirar.** Es una app offline-first: sin relay, sin red
 *    o sin clave, todo lo local tiene que seguir andando.
 */

/** Sobres que se leen de un buzón de invitación. Alcanza y sobra. */
const MAX_ENVELOPES = 50;

/** Publica el reclamo: "soy esta persona, entregame la clave a esta pública". */
export async function publishClaim(invite: GroupInvite, deviceId: string): Promise<boolean> {
  const me = useAuthStore.getState().currentUser;
  if (!me || isInviteExpired(invite)) return false;

  const identity = ensureIdentity();
  const wrap = ensureWrapKeypair();

  const claim: InviteClaim = {
    kind: 'claim',
    groupId: invite.groupId,
    userId: me.id,
    wrapPublicKey: wrap.publicKey,
    identityPublicKey: identity.publicKey,
    displayName: me.name,
    claimedAt: Date.now(),
  };

  // Se guarda ANTES de mandar: si el envío falla por red, el ingreso sigue
  // pendiente y se reintenta al próximo arranque. Guardarlo después perdería
  // exactamente el caso en el que hace falta.
  savePendingJoin(invite);

  try {
    const topic = await deriveInviteTopic(invite.token);
    const r = await sendEnvelope(topic, await sealClaim(invite.token, claim), deviceId);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Procesa el buzón de una invitación, en los dos roles a la vez.
 *
 * Que sea una sola función y no dos es a propósito: el buzón es compartido y el
 * rol lo decide el contenido de cada sobre, no quién llama. Devuelve los grupos
 * cuya clave adoptamos — el llamador es el que sabe qué hacer con eso (drenar,
 * resuscribirse), y así este módulo no depende del motor del relay.
 */
export async function processInvite(invite: GroupInvite, deviceId: string): Promise<string[]> {
  const me = useAuthStore.getState().currentUser;
  if (!me || isInviteExpired(invite)) return [];

  let topic: string;
  try {
    topic = await deriveInviteTopic(invite.token);
  } catch {
    return [];
  }

  const r = await fetchSince(topic, 0, deviceId, MAX_ENVELOPES);
  if (!r.ok) return [];

  const adoptados: string[] = [];

  for (const envelope of r.envelopes) {
    // Un sobre ajeno o corrupto no puede frenar la cola: el buzón es público
    // para cualquiera que tenga el link.
    try {
      const claim = await openClaim(invite.token, envelope.payload);
      if (claim) { await admit(claim, invite, topic, deviceId, me.id); continue; }

      const grant = await openGrant(invite.token, envelope.payload, invite.inviterFingerprint);
      if (grant && redeem(grant, invite, me.id)) adoptados.push(grant.groupId);
    } catch { /* sobre inservible: se saltea */ }
  }

  return adoptados;
}

/**
 * Lado del que invita: suma al que reclama y le entrega la clave.
 *
 * Se re-entrega cada vez que se ve el reclamo, aunque ya sea miembro. Es el
 * mecanismo de reintento: si la entrega anterior se perdió, el invitado quedaría
 * esperando para siempre sin nada que la vuelva a mandar.
 */
async function admit(
  claim: InviteClaim,
  invite: GroupInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<void> {
  if (claim.groupId !== invite.groupId || claim.userId === myUserId) return;

  // Sólo puede admitir un miembro vivo que tenga la clave. Un tercero con el
  // link no puede fabricar una entrega válida porque no la tiene.
  const record = useGroupKeyStore.getState().getKey(claim.groupId);
  const group = useGroupStore.getState().getById(claim.groupId);
  if (!record || !group || group.isDeleted || !group.memberIds.includes(myUserId)) return;

  const users = useUserStore.getState();
  if (!users.getUserById(claim.userId)) {
    users.addOrUpdateUser({
      id: claim.userId,
      name: claim.displayName || 'Invitado',
      email: '',
      authProvider: 'google',
      createdAt: Date.now(),
      updatedAt: syncedNow(),
      isDeleted: false,
    });
  }

  if (!group.memberIds.includes(claim.userId)) {
    useGroupStore.getState().updateGroup(group.id, {
      memberIds: [...group.memberIds, claim.userId],
    });
  }

  // Primero el estado del grupo, después la llave para leerlo. Al revés, el
  // invitado abriría un buzón vacío y se quedaría sin grupo.
  try { await publishToGroup(group.id, myUserId, deviceId); } catch { /* se reintenta */ }

  const wrap = ensureWrapKeypair();
  const identity = ensureIdentity();

  const sealed = await sealGrant(invite.token, {
    groupId: group.id,
    forUserId: claim.userId,
    wrappedKey: wrapGroupKey(record.key, claim.wrapPublicKey, wrap.privateKey),
    senderWrapPublicKey: wrap.publicKey,
    grantedByIdentity: identity.publicKey,
    epoch: record.epoch,
    grantedAt: Date.now(),
  }, identity.privateKey);

  await sendEnvelope(topic, sealed, deviceId);
}

/** Lado del que entra: abre la clave y la adopta. `true` si adoptó algo nuevo. */
function redeem(grant: InviteGrant, invite: GroupInvite, myUserId: string): boolean {
  if (grant.forUserId !== myUserId || grant.groupId !== invite.groupId) return false;
  if (useGroupKeyStore.getState().getKey(grant.groupId)) {
    removePendingJoin(invite.token); // ya la teníamos: el ingreso está cerrado
    return false;
  }

  const wrap = ensureWrapKeypair();
  const key = unwrapGroupKey(grant.wrappedKey, grant.senderWrapPublicKey, wrap.privateKey);

  // Una clave del largo equivocado no se adopta: dejaría el grupo ilegible para
  // siempre y sin síntoma más claro que "no llega nada".
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return false;

  useGroupKeyStore.getState().adoptKeys([
    { groupId: grant.groupId, key, epoch: grant.epoch },
  ]);
  removePendingJoin(invite.token);
  return true;
}

/** Invitaciones vivas de los dos lados: las que emitimos y las que aceptamos. */
export function activeInvites(): GroupInvite[] {
  const todas = [...listInvites(), ...listPendingJoins()];
  const porToken = new Map(todas.map(i => [i.token, i]));
  return [...porToken.values()];
}

/** Procesa todos los buzones de invitación. Devuelve los grupos adoptados. */
export async function processAllInvites(deviceId: string): Promise<string[]> {
  const adoptados: string[] = [];
  for (const invite of activeInvites()) {
    adoptados.push(...await processInvite(invite, deviceId));
  }
  return adoptados;
}
