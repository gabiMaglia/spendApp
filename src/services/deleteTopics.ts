import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/envelopeCrypto';
import { deriveContactTopic, listPeers } from '@/src/sync/contactChannel';
import { deriveInviteTopic } from '@/src/sync/groupInvite';
import { listInvites, listPendingJoins } from '@/src/store/identityStore';

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

  for (const record of useGroupKeyStore.getState().keys) {
    const key = groupKeyBytes(record.groupId);
    // `groupKeyBytes` devuelve un array VACÍO si la clave está en blanco
    // (`fromHex('')`), y eso es truthy: sin mirar el largo se derivaría un topic
    // a partir de nada, al que nadie publicó nunca.
    if (!key || key.length === 0) continue;
    try {
      topics.add(await deriveTopic(key, record.epoch));
    } catch { /* un grupo que no deriva no puede frenar el borrado */ }
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
