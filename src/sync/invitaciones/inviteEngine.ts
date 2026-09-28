import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import {
  ensureIdentity, ensureWrapKeypair,
  savePendingJoin, removePendingJoin, listInvites, listPendingJoins,
  msDesdePrimerReclamo,
} from '@/src/store/identityStore';
import { sendEnvelope, fetchSince } from '@/src/sync/adaptadores/supabase/relay';
import {
  deriveInviteTopic, sealClaim, openClaim, openGrant,
  unwrapGroupKey, isInviteExpired,
  type GroupInvite, type InviteClaim, type InviteGrant,
} from './groupInvite';
import { withTimeout } from '@/src/utils/withTimeout';
import { announceJoinStalled, resolveJoinStalled } from '@/src/services/notifications';
import {
  claveLocalVinoDeContacto, idDeOfertaDeInvitacion, olvidarOfertas, registrarOferta,
} from './groupKeyOffers';
import { avisarConflictoDeClave } from './keyConflictNotice';
import { admit } from './inviteAdmit';

/** T-138-bis: ver `processAllInvites`. */
const INVITE_TIMEOUT_MS = 8_000;

/**
 * Tiempo sin recibir grant antes de avisarle al invitado (T-172, ítem 2 —
 * ronda 2/5, D1 del verificador).
 *
 * **La ronda 1 contaba LLAMADAS a `processInvite`, no tiempo, y eso era
 * falso respecto de cómo se llama de verdad:**
 *  - `app/groups/join.tsx:37-38,72-84` sondea el buzón cada `REINTENTO_MS`
 *    (3s) durante `ESPERA_MS` (25s) mientras la pantalla sigue abierta —
 *    unas 8 llamadas en 25 SEGUNDOS, no en varios ciclos de sync.
 *  - `relayEngine.ts` además llama `processAllInvites` desde `doStartRelay`
 *    (arranque, reconexión) y desde `onInviteNews` cada vez que el buzón de
 *    invitaciones tiene novedades — ninguna de las dos espera 15 minutos.
 *  - Con esos llamadores, 6 llamadas se agotaban en ~16s: el caso más común
 *    (un link por WhatsApp, el invitador sin la app abierta todavía) avisaba
 *    "no se completó" segundos después de tocar "Unirme", aunque el ingreso
 *    terminara bien apenas el invitador abriera la app.
 *
 * **Ahora se mide tiempo real desde el primer reclamo** (`firstAttemptAt`,
 * `msDesdePrimerReclamo`), sin importar cuántas veces se sondeó el buzón.
 * 24hs — la mitad del TTL de 48hs de la invitación (regla 9 de CLAUDE.md) —
 * es defendible en las dos puntas: le da al invitador un día entero para
 * abrir la app alguna vez (el único evento que dispara `admit`, sin el cual
 * el ingreso nunca cierra solo), y deja al invitado con otras 24hs de
 * invitación viva para pedir un link nuevo si de verdad hace falta.
 */
export const JOIN_STALL_NOTICE_AFTER_MS = 24 * 60 * 60 * 1000;

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
 *
 * Single-use invites (T-096 · ADR-015): el primer reclamo válido de distinto
 * usuario consume la invitación para cualquier otro. El chequeo es sólo contra
 * lo PERSISTIDO (`findInviteToken`/`actual.claimedBy` en `admit`) — no hay
 * rastreo aparte en memoria dentro del batch, ese mecanismo (`claimedByInBatch`)
 * se sacó en una ronda de fixes anterior. El MISMO reclamante puede reintentar
 * (idempotente).
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
      if (claim) {
        if (!await admit(claim, invite, topic, deviceId, me.id)) continue;
        continue;
      }

      const grant = await openGrant(invite.token, envelope.payload, invite.inviterFingerprint);
      if (grant && await redeem(grant, invite, me.id)) adoptados.push(grant.groupId);
    } catch { /* sobre inservible: se saltea */ }
  }

  // T-172 (ítem 2): si esta pasada NO adoptó el grupo de esta invitación, es
  // un intento más sin éxito del lado de quien reclama. `msDesdePrimerReclamo`
  // sólo devuelve algo si `invite.token` sigue siendo un join PENDIENTE de
  // este dispositivo (`null` si no — por ejemplo, somos quien invita, o el
  // join ya se resolvió y `removePendingJoin` lo borró más arriba, en el
  // mismo pase), así que este bloque es un no-op inofensivo del lado de
  // quien invita, y no dispara nada en el mismo pase donde `redeem` acaba de
  // cerrar el ingreso.
  if (!adoptados.includes(invite.groupId)) {
    const esperando = msDesdePrimerReclamo(invite.token);
    if (esperando !== null && esperando >= JOIN_STALL_NOTICE_AFTER_MS) {
      void announceJoinStalled(invite.groupId, invite.groupName, invite.token);
    }
  }

  return adoptados;
}

/**
 * Lado del que entra: abre la clave y la adopta. `true` si adoptó algo nuevo.
 *
 * T-136 · ADR-013: si ya hay clave local y vino de CONTACTO, un grant con otra
 * clave no se cierra en silencio — queda como oferta de la invitación y se
 * avisa el conflicto. Una clave local de `ensureKey`, QR o invitación cierra el
 * ingreso como siempre (S3-A1).
 */
async function redeem(grant: InviteGrant, invite: GroupInvite, myUserId: string): Promise<boolean> {
  if (grant.forUserId !== myUserId || grant.groupId !== invite.groupId) return false;

  const wrap = ensureWrapKeypair();
  const abierta = unwrapGroupKey(grant.wrappedKey, grant.senderWrapPublicKey, wrap.privateKey);
  // Una clave del largo equivocado no se adopta ni se ofrece: dejaría el grupo
  // ilegible para siempre y sin síntoma más claro que "no llega nada".
  const clave = abierta && /^[0-9a-f]{64}$/i.test(abierta) ? abierta : null;

  const local = useGroupKeyStore.getState().getKey(grant.groupId);
  if (local) {
    if (clave !== null && clave.toLowerCase() !== local.key.toLowerCase() && claveLocalVinoDeContacto(grant.groupId)) {
      const nueva = registrarOferta({
        groupId: grant.groupId,
        fromUserId: idDeOfertaDeInvitacion(invite.inviterFingerprint),
        key: clave.toLowerCase(),
        epoch: grant.epoch,
        origen: 'invite',
        receivedAt: Date.now(),
        adoptada: false,
      });
      if (nueva) await avisarConflictoDeClave(grant.groupId, invite.groupName);
    }
    // El ingreso por link está cerrado: o ya la teníamos, o decide el usuario
    // desde el aviso.
    removePendingJoin(invite.token);
    // T-172 (ítem 2, ronda 2/5): el ingreso cerró bien, así que un aviso de
    // demora que hubiera salido para este token queda contradiciendo un
    // ingreso exitoso si no se retira acá.
    resolveJoinStalled(invite.token);
    return false;
  }

  if (!clave) return false;

  // El grupo no tenía clave, así que esta invitación lo resuelve de verdad. Las
  // ofertas de contacto que hubieran quedado dando vueltas —y la marca de
  // conflicto FORZADO, que `olvidarOfertas` limpia junto con ellas— ya no
  // describen nada: sin esto, la tarjeta de conflicto seguiría ofreciendo como
  // única salida borrar un grupo que acaba de quedar bien (revisión final,
  // D-3). Va ANTES de `adoptKeys`, como la purga de `elegirClaveDeGrupo`: la
  // clave recién adoptada queda sin oferta adoptada que la respalde, así que
  // `claveLocalVinoDeContacto` da `false` y no es disputable por contacto
  // (S3-A1). Si después llegan ofertas de contacto, arrancan de cero.
  olvidarOfertas(grant.groupId);

  useGroupKeyStore.getState().adoptKeys([
    { groupId: grant.groupId, key: clave, epoch: grant.epoch },
  ]);
  removePendingJoin(invite.token);
  // T-172 (ítem 2, ronda 2/5): mismo motivo que arriba — el ingreso acaba de
  // completarse de verdad, no puede quedar un aviso diciendo lo contrario.
  resolveJoinStalled(invite.token);
  return true;
}

/** Invitaciones vivas de los dos lados: las que emitimos y las que aceptamos. */
export function activeInvites(): GroupInvite[] {
  const todas = [...listInvites(), ...listPendingJoins()];
  const porToken = new Map(todas.map(i => [i.token, i]));
  return [...porToken.values()];
}

/**
 * Procesa todos los buzones de invitación. Devuelve los grupos adoptados.
 *
 * **T-138-bis**: cada invitación tiene `INVITE_TIMEOUT_MS` para responder. Sin
 * esto, una sola invitación cuyo pedido de red se cuelga (ni resuelve ni
 * rechaza — un `try/catch` no lo detecta) frena TODO `doStartRelay` para
 * siempre: nunca se llega a `subscribeContacts`, `anunciarMiTarjeta` ni
 * `startPolling`, y como el polling es lo único que reintentaría solo, la
 * sync completa queda muerta hasta reinstalar. Medido en producción: pasó de
 * verdad con una invitación de contacto vieja.
 */
export async function processAllInvites(deviceId: string): Promise<string[]> {
  const adoptados: string[] = [];
  for (const invite of activeInvites()) {
    adoptados.push(...await withTimeout(processInvite(invite, deviceId), INVITE_TIMEOUT_MS, []));
  }
  return adoptados;
}
