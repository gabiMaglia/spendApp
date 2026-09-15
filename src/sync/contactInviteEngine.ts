import { useAuthStore } from '@/src/store/authStore';
import {
  ensureIdentity, findContactInviteToken, markContactInviteClaimed,
  savePendingContactClaim, listContactInvites, listPendingContactClaims,
  removePendingContactClaim,
} from '@/src/store/identityStore';
import { sendEnvelope, fetchSince } from './relay';
import {
  deriveContactInviteTopic, sealContactClaim, openContactClaim,
  sealContactGrant, openContactGrant, isContactInviteExpired,
  type ContactInvite,
} from './contactInvite';
import { myContactCard, savePeerFromCard, type ContactCard } from './contactChannel';

/**
 * El encuentro entre quien comparte un link de contacto y quien lo abre
 * (T-096 · ADR-015). Mismo patrón que `inviteEngine.ts` para la invitación a
 * grupo, pero intercambiando `ContactCard` en vez de una clave de grupo.
 */

const MAX_ENVELOPES = 50;

/** Publica mi tarjeta como reclamo, en el buzón efímero del token. */
export async function publishContactClaim(invite: ContactInvite, deviceId: string): Promise<boolean> {
  const card = myContactCard();
  if (!card || isContactInviteExpired(invite)) return false;

  // Se guarda ANTES de mandar (mismo motivo que `publishClaim` de inviteEngine.ts):
  // si el envío falla por red, el pedido sigue pendiente y se reintenta solo.
  savePendingContactClaim(invite);

  try {
    const topic = await deriveContactInviteTopic(invite.token);
    const r = await sendEnvelope(topic, await sealContactClaim(invite.token, card), deviceId);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Lado de quien comparte el link: admite el primer reclamo válido.
 *
 * Un solo uso (T-096): si ESTE dispositivo no fue quien generó la invitación
 * (`findContactInviteToken` no la encuentra), no hay nada que admitir — soy
 * sólo el reclamante. Si ya la admití para otra persona, un reclamante nuevo
 * se ignora sin efecto.
 */
async function admitContactClaim(
  claim: ContactCard,
  invite: ContactInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<boolean> {
  if (claim.userId === myUserId) return false;

  const actual = findContactInviteToken(invite.token);
  if (!actual) return false; // no soy quien la generó
  if (actual.claimedBy && actual.claimedBy !== claim.userId) return false;

  const me = myContactCard();
  if (!me) return false;

  if (!actual.claimedBy) markContactInviteClaimed(invite.token, claim.userId);

  // Guardo al que reclamó: nunca pisa una clave pinneada que ya tuviera
  // (mismo criterio que `savePeerFromCard` en cualquier tarjeta que llega por
  // relay, no por presencia física).
  savePeerFromCard(claim.userId, {
    secret: claim.contactSecret,
    wrapPublicKey: claim.wrapPublicKey,
    identityPublicKey: claim.identityPublicKey,
  });

  const identity = ensureIdentity();
  // `forUserId` (T-096 · ADR-015): sin esto, cualquier otro reclamante que
  // lea el mismo tópico público recibiría igual mi tarjeta real —secreto de
  // contacto permanente incluido— aunque nunca haya sido admitido.
  const sealed = await sealContactGrant(invite.token, me, claim.userId, identity.privateKey);
  await sendEnvelope(topic, sealed, deviceId);
  return true;
}

/**
 * Procesa el buzón efímero de una invitación de contacto, en los dos roles a
 * la vez — igual razón que `processInvite` de `inviteEngine.ts`: el rol lo
 * decide el contenido de cada sobre, no quién llama.
 *
 * Devuelve `true` si pasó algo nuevo: admití a alguien (quien comparte) o
 * recibí la tarjeta real de quien compartió (quien reclamó).
 */
export async function processContactInvite(invite: ContactInvite, deviceId: string): Promise<boolean> {
  const me = useAuthStore.getState().currentUser;
  if (!me || isContactInviteExpired(invite)) return false;

  let topic: string;
  try {
    topic = await deriveContactInviteTopic(invite.token);
  } catch {
    return false;
  }

  const r = await fetchSince(topic, 0, deviceId, MAX_ENVELOPES);
  if (!r.ok) return false;

  let huboNovedad = false;

  for (const envelope of r.envelopes) {
    try {
      const claim = await openContactClaim(invite.token, envelope.payload);
      if (claim) {
        if (await admitContactClaim(claim, invite, topic, deviceId, me.id)) huboNovedad = true;
        continue;
      }

      const grant = await openContactGrant(invite.token, envelope.payload, invite.inviterFingerprint);
      // `forUserId` viaja adentro de lo firmado (T-096 · ADR-015): un grant
      // dirigido a otro reclamante no es para mí, aunque lo haya podido leer
      // en el mismo tópico público.
      if (grant && grant.forUserId === me.id) {
        savePeerFromCard(grant.card.userId, {
          secret: grant.card.contactSecret,
          wrapPublicKey: grant.card.wrapPublicKey,
          identityPublicKey: grant.card.identityPublicKey,
        });
        removePendingContactClaim(invite.token);
        huboNovedad = true;
      }
    } catch { /* sobre inservible: se saltea */ }
  }

  return huboNovedad;
}

/** Invitaciones de contacto vivas de los dos lados: las que emití y las que estoy reclamando. */
export function activeContactInvites(): ContactInvite[] {
  const todas = [...listContactInvites(), ...listPendingContactClaims()];
  const porToken = new Map(todas.map(i => [i.token, i]));
  return [...porToken.values()];
}

/** Procesa todos los buzones de invitación de contacto. `true` si hubo alguna novedad. */
export async function processAllContactInvites(deviceId: string): Promise<boolean> {
  let algo = false;
  for (const invite of activeContactInvites()) {
    if (await processContactInvite(invite, deviceId)) algo = true;
  }
  return algo;
}
