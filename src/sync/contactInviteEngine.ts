import { useAuthStore } from '@/src/store/authStore';
import {
  ensureIdentity, ensureWrapKeypair, findContactInviteToken, markContactInviteClaimed,
  savePendingContactClaim, listContactInvites, listPendingContactClaims,
  removePendingContactClaim,
} from '@/src/store/identityStore';
import { sendEnvelope, fetchSince } from './relay';
import {
  deriveContactInviteTopic, sealContactClaim, openContactClaim,
  sealContactGrant, openContactGrant, isContactInviteExpired,
  type ContactInvite, type ContactClaim,
} from './contactInvite';
import { unwrapGroupKey } from './groupInvite';
import { myContactCard, savePeerFromCard } from './contactChannel';
import { withTimeout } from '@/src/utils/withTimeout';

/**
 * El encuentro entre quien comparte un link de contacto y quien lo abre
 * (T-096 · ADR-015). Mismo patrón que `inviteEngine.ts` para la invitación a
 * grupo, pero intercambiando `ContactCard` en vez de una clave de grupo.
 */

/** T-138-bis: ver `processAllContactInvites` (mismo criterio que `inviteEngine.ts`). */
const CONTACT_INVITE_TIMEOUT_MS = 8_000;

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
    // Mi `contactSecret` viaja envuelto a la pública de quien invita (I1,
    // cierre — revisión final de T-096 · ADR-015): sin esto, cualquier
    // bystander con el mismo link reenviado leía mi secreto permanente igual
    // que cualquier cliente legítimo, con sólo abrir el sobre del token.
    const wrap = ensureWrapKeypair();
    const sealed = await sealContactClaim(invite.token, card, invite.inviterWrapPublicKey, wrap.privateKey);
    const r = await sendEnvelope(topic, sealed, deviceId);
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
  claim: ContactClaim,
  invite: ContactInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<boolean> {
  if (claim.card.userId === myUserId) return false;

  const actual = findContactInviteToken(invite.token);
  if (!actual) return false; // no soy quien la generó
  if (actual.claimedBy && actual.claimedBy !== claim.card.userId) return false;

  const me = myContactCard();
  if (!me) return false;

  const wrap = ensureWrapKeypair();
  // El secreto del reclamante viaja envuelto a MI pública de envoltura (I1,
  // cierre — revisión final de T-096 · ADR-015): sólo mi privada lo destapa,
  // aunque cualquier otro con el mismo link haya podido abrir el sobre
  // exterior con la clave del token. `claim.card.wrapPublicKey` es la pública
  // de envoltura del RECLAMANTE — con ella deriva el mismo secreto compartido.
  const secretoReclamante = unwrapGroupKey(claim.wrappedSecret, claim.card.wrapPublicKey, wrap.privateKey);
  if (!secretoReclamante || !/^[0-9a-f]{64}$/i.test(secretoReclamante)) return false;

  if (!actual.claimedBy) markContactInviteClaimed(invite.token, claim.card.userId);

  // Guardo al que reclamó: nunca pisa una clave pinneada que ya tuviera
  // (mismo criterio que `savePeerFromCard` en cualquier tarjeta que llega por
  // relay, no por presencia física).
  savePeerFromCard(claim.card.userId, {
    secret: secretoReclamante,
    wrapPublicKey: claim.card.wrapPublicKey,
    identityPublicKey: claim.card.identityPublicKey,
  });

  const identity = ensureIdentity();
  // `forUserId` + secreto ENVUELTO (T-096 · ADR-015, C2 de la revisión final):
  // `claim.card.wrapPublicKey` es la pública de envoltura del reclamante — es
  // a ELLA que se envuelve mi `contactSecret`, no sólo se sella con la clave
  // del token. Sin esto, cualquier otro que tenga el mismo link (admitido o
  // no) leería igual mi secreto permanente en el sobre público de esta entrega.
  const sealed = await sealContactGrant(
    invite.token, me, claim.card.userId, claim.card.wrapPublicKey, identity.privateKey, wrap.privateKey,
  );
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
        // El secreto viaja envuelto para MI pública de envoltura (C2, revisión
        // final): sólo mi privada lo destapa, aunque cualquier otro con el
        // mismo link haya podido abrir el sobre exterior con la clave del token.
        const wrap = ensureWrapKeypair();
        const secret = unwrapGroupKey(grant.wrappedSecret, grant.card.wrapPublicKey, wrap.privateKey);
        if (secret && /^[0-9a-f]{64}$/i.test(secret)) {
          savePeerFromCard(grant.card.userId, {
            secret,
            wrapPublicKey: grant.card.wrapPublicKey,
            identityPublicKey: grant.card.identityPublicKey,
          });
          removePendingContactClaim(invite.token);
          huboNovedad = true;
        }
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
    if (await withTimeout(processContactInvite(invite, deviceId), CONTACT_INVITE_TIMEOUT_MS, false)) algo = true;
  }
  return algo;
}
