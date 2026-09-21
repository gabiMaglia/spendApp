import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/envelopeCrypto';
import { deriveContactTopic, listPeers } from '@/src/sync/contactChannel';
import { deriveInviteTopic } from '@/src/sync/groupInvite';
import { deriveAvatarTopic } from '@/src/sync/avatarTopic';
import { listInvites, listPendingJoins } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';

/**
 * Los topics del buzón donde este aparato dejó sobres (T-074 §3.4).
 *
 * **Son tres tipos, no uno.** `deleteMyGroupEnvelopes` cubre sólo el del grupo;
 * si los otros dos no se purgan, el borrado de cuenta deja rastro:
 *
 * 1. **Grupos** — un topic por clave de grupo del scope.
 * 2. **Contactos** — mis sobres de contacto **no están en mi buzón: están en el
 *    del otro**. `announceContact` y `sendGroupKey` publican en el topic
 *    derivado del secreto de CADA peer, así que hay que recorrerlos.
 *    *Mi propio topic no entra: lo que hay ahí lo publicaron otros, la prenda no
 *    coincide y no se borra. Correcto — no son míos.*
 * 3. **Invitaciones** — el topic sale del token, tanto para el reclamo como
 *    para la entrega de clave.
 * 4. **Foto propia por referencia (ADR-007)** — un topic por cada grupo donde
 *    esta cuenta la publicó, derivado de (clave del grupo, mi id, mi
 *    `avatarDigest` ACTUAL). Sólo cubre la foto vigente, no las versiones
 *    viejas que ya se reemplazaron: esas no se pueden re-derivar sin conocer
 *    su digest, y el TTL de 30 días las levanta solas — daño acotado, no una
 *    fuga permanente.
 *
 * ⚠️ Las invitaciones y los ingresos pendientes son del **aparato**, no de la
 * cuenta (`identityStore`, docblock): con dos cuentas enlazadas se purgan igual
 * —los sobres los escribió esta prenda, que también es del aparato— y se pueden
 * estar borrando invitaciones que emitió la otra cuenta. El daño es acotado (una
 * invitación muerta se reemite) y **es la única opción**: `GroupInvite` no
 * guarda quién invitó, así que no hay con qué distinguirlas.
 *
 * Se llama ANTES de borrar nada: las claves de las que salen estos topics son
 * justamente lo que el borrado destruye. Devuelve una lista sin repetidos, y
 * nunca lanza: un topic que no se puede derivar se omite.
 */
export async function topicsDeLaCuenta(): Promise<string[]> {
  const topics = new Set<string>();
  const yo = useAuthStore.getState().currentUser;
  const avatarDigest = yo ? useUserStore.getState().getUserById(yo.id)?.avatarDigest : undefined;

  for (const record of useGroupKeyStore.getState().keys) {
    const key = groupKeyBytes(record.groupId);
    // `groupKeyBytes` devuelve un array VACÍO si la clave está en blanco
    // (`fromHex('')`), y eso es truthy: sin mirar el largo se derivaría un topic
    // a partir de nada, al que nadie publicó nunca.
    if (!key || key.length === 0) continue;
    try {
      topics.add(await deriveTopic(key, record.epoch));
    } catch { /* un grupo que no deriva no puede frenar el borrado */ }

    if (yo && avatarDigest) {
      try {
        topics.add(await deriveAvatarTopic(key, yo.id, avatarDigest));
      } catch { /* idem */ }
    }
  }

  for (const peer of Object.values(listPeers())) {
    if (!peer?.secret) continue;
    try {
      topics.add(await deriveContactTopic(peer.secret));
    } catch { /* idem */ }
  }

  for (const invite of [...listInvites(), ...listPendingJoins()]) {
    if (!invite?.token) continue;
    try {
      topics.add(await deriveInviteTopic(invite.token));
    } catch { /* idem */ }
  }

  return [...topics];
}
