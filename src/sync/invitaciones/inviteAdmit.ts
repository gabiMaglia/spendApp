import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity, ensureWrapKeypair, findInviteToken, markInviteClaimed } from '@/src/store/identityStore';
import { publishToGroup } from '@/src/sync/motor/relaySync';
import { getPeer } from '@/src/sync/contactos/contactChannel';
import { sendEnvelope } from '@/src/sync/adaptadores/supabase/relay';
import { sealGrant, wrapGroupKey, type GroupInvite, type InviteClaim } from './groupInvite';
import { syncedNow } from '@/src/utils/syncedClock';
import { recordError } from '@/src/services/errorLog';
import { announceInviteFull } from '@/src/services/notifications';
import { admiteUnMiembroMas } from '@/src/sync/nucleo/topes';
import { conAlta } from '@/src/algorithms/roster';

/**
 * Lado del que invita: suma al que reclama y le entrega la clave (T-192:
 * salió de `inviteEngine.ts`, que le pasaba `topic`/`deviceId` — mismo código).
 *
 * Se re-entrega cada vez que se ve el reclamo, aunque ya sea miembro. Es el
 * mecanismo de reintento: si la entrega anterior se perdió, el invitado quedaría
 * esperando para siempre sin nada que la vuelva a mandar.
 *
 * Single-use guard (T-096 · ADR-015): Re-lee el campo `claimedBy` persistido
 * antes de admitir. Si ya fue reclamado por otro usuario, rechaza. El mismo
 * usuario puede reintentar (idempotente).
 */
export async function admit(
  claim: InviteClaim,
  invite: GroupInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<boolean> {
  if (claim.groupId !== invite.groupId || claim.userId === myUserId) return false;

  // Un solo uso (T-096 · ADR-015): el primer reclamo válido consume la
  // invitación para cualquier otra persona. El MISMO reclamante puede seguir
  // reintentando — es lo que ya hace resiliente el reintento existente.
  //
  // Solo quien EMITIÓ la invitación puede admitir reclamos. Quien solo reclama
  // (no tiene record de haber emitido) rechaza automáticamente. Esto previene
  // que un segundo device (claimant en un grupo, nunca inviter) admita claims.
  const actual = findInviteToken(invite.groupId, invite.token);
  if (!actual) return false; // Este dispositivo no emitió esta invitación — no puede admitir (T-096)
  if (actual.claimedBy && actual.claimedBy !== claim.userId) {
    // D3 (T-151): rechazo por seguridad con rastro corto, sin claves completas.
    recordError({ message: 'admit_rechazado: ya_reclamado_por_otro_usuario', fatal: false, screen: 'sync.invite' });
    return false;
  }

  // Sólo puede admitir un miembro vivo que tenga la clave. Un tercero con el
  // link no puede fabricar una entrega válida porque no la tiene.
  const record = useGroupKeyStore.getState().getKey(claim.groupId);
  const group = useGroupStore.getState().getById(claim.groupId);
  if (!record || !group || group.isDeleted || !group.memberIds.includes(myUserId)) return false;

  /**
   * SEC-06 (T-151): un reclamo a nombre de alguien que YA es miembro no puede
   * ser un ingreso franco — o es esa misma persona (reinstalando, o
   * reintentando porque la entrega anterior no salió), o es alguien
   * usándole el nombre para recibir la clave sin figurar como miembro nuevo
   * ni disparar `joined`.
   *
   * La identidad Ed25519 sola NO prueba nada: es pública, viaja en la tarjeta
   * de contacto (`contactChannel.ts:146`) y en cada registro que esa persona
   * firma (`recordSign.ts:45`), así que cualquiera puede copiarla en su
   * reclamo. Lo que sí prueba algo es hacia DÓNDE se envuelve la clave del
   * grupo: la entrega envuelve hacia `claim.wrapPublicKey` (X25519,
   * `wrapGroupKey` más abajo), y sólo quien tiene la PRIVADA correspondiente
   * puede abrirla. Por eso se exige que TANTO `wrapPublicKey` como
   * `identityPublicKey` coincidan con las que ya teníamos pinneadas para ese
   * id (`getPeer`, que guarda `wrapPublicKey` desde el intercambio de
   * contacto — `contactChannel.ts:115`): aunque Mallory copie las dos claves
   * públicas de Beto, la única forma de que EL RECLAMO pase este chequeo con
   * la wrap real de Beto es que la clave salga envuelta hacia esa wrap — y
   * ahí sólo Beto, dueño de la privada, puede abrirla. Es prueba de posesión
   * implícita, sin tocar el protocolo de claim (no se firma).
   *
   * Excepción: el MISMO reclamante reintentando. Si la entrega anterior no
   * salió (sin red, por ejemplo) el invitado ya quedó sumado a `memberIds`
   * sin estar pinneado en ningún lado — no hay pinned que pueda coincidir, y
   * sin esta excepción quedaría bloqueado para siempre (D2 del verificador).
   * `claimedWrapKey` (guardado en el primer reclamo, T-151) identifica a ese
   * mismo reclamante: mismo `userId` Y misma wrap que la primera vez. Otra
   * wrap con el mismo `userId` no es él — es alguien más con el link
   * reclamando "como" el invitado tras su primer canje, y se rechaza igual
   * que cualquier otro miembro no pinneado.
   */
  if (group.memberIds.includes(claim.userId)) {
    const esReintentoDelMismoReclamante =
      actual.claimedBy === claim.userId &&
      actual.claimedWrapKey !== undefined &&
      actual.claimedWrapKey.toLowerCase() === claim.wrapPublicKey.toLowerCase();

    if (!esReintentoDelMismoReclamante) {
      const pinneada = getPeer(claim.userId);
      const coincide = !!pinneada?.wrapPublicKey && !!pinneada.identityPublicKey
        && pinneada.wrapPublicKey.toLowerCase() === claim.wrapPublicKey.toLowerCase()
        && pinneada.identityPublicKey.toLowerCase() === claim.identityPublicKey.toLowerCase();
      if (!coincide) {
        // D3 (T-151): rechazo por seguridad con rastro corto, sin claves completas.
        recordError({ message: 'admit_rechazado: claim_a_nombre_de_miembro_sin_prueba_de_posesion', fatal: false, screen: 'sync.invite' });
        return false;
      }
    }
  }

  // T-150 ronda 2 (D4, verifier): `admit()` es un camino sin UI del lado de
  // quien invita — un grupo nunca debe superar MAX_MIEMBROS tampoco por acá.
  // Sólo aplica si `claim.userId` sería NUEVO: un reintento de alguien que ya
  // es miembro no se bloquea (no suma a nadie). Rechazo total (no se marca
  // canjeado, no se entrega nada), con rastro en el diagnóstico Y un aviso
  // visible en la bandeja de quien invita (T-150 ronda 2/5, ruling del
  // orquestador): el diagnóstico solo no lo ve nadie, y `announceInviteFull`
  // ya dedupe por invitación así que no apila un aviso por reintento.
  if (!group.memberIds.includes(claim.userId) && !admiteUnMiembroMas(group.memberIds)) {
    recordError({ message: 'admit_rechazado: tope_de_miembros', fatal: false, screen: 'sync.invite' });
    void announceInviteFull(group.id, group.name, invite.token);
    return false;
  }

  // Marcar como canjeado en storage si no estaba ya (para robustez entre app closes).
  // `actual` ya está garantizado no-nulo por el `if (!actual) return false` de arriba.
  // Se persiste también la wrap del reclamo (T-151): es lo que permite
  // reconocer al mismo reclamante en un reintento (ver bloque de arriba).
  if (!actual.claimedBy) markInviteClaimed(invite.groupId, invite.token, claim.userId, claim.wrapPublicKey);

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
      miembros: conAlta(group, claim.userId, syncedNow()).miembros,
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
  return true;
}
