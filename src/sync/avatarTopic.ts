import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex, sealEnvelope, openEnvelope } from './envelopeCrypto';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { sendEnvelope, fetchSince } from './relay';
import { ensureIdentity } from '@/src/store/identityStore';
import { groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { recordSlicePublished, staleSliceCkeys } from './sliceRenewal';

/**
 * Fotos de perfil por referencia (Task 9): en vez de reenviar los bytes del
 * `avatar` de cada usuario en CADA publicación de la rebanada `users`
 * (`relaySync.ts`), la foto viaja UNA vez a su propio topic —derivado del
 * contenido, no del usuario ni de la publicación— y el resto de los sobres
 * sólo llevan `avatarDigest` como referencia.
 *
 * Mismo mecanismo de derivación que `deriveCkey` (`slices.ts`) y `deriveTopic`
 * (`envelopeCrypto.ts`): SHA256 de la clave del grupo en hex más contexto. El
 * digest entra en la fórmula a propósito — dos fotos distintas del mismo
 * usuario caen en topics distintos, así que nunca hace falta "reemplazar" ni
 * coordinar compactación entre versiones de la misma foto: cada una vive en
 * su propio lugar y el TTL de 30 días se encarga de la que ya nadie referencia.
 */
export async function deriveAvatarTopic(
  key: GroupKey,
  userId: string,
  avatarDigest: string,
): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:avatar:${userId}:${avatarDigest}`,
  );
}

async function digestAvatar(avatar: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, avatar);
}

/**
 * Publica la foto propia en su topic si cambió desde la última vez.
 *
 * El "cambió" se mide por digest, no por contenido byte a byte: mismo digest
 * = misma foto = nada que hacer. La dedup reutiliza `sliceRenewal.ts` (Task 8)
 * con un marcador propio (`avatar:<userId>:<digest>`) en vez de una `ckey` —
 * es el mismo problema ("¿ya publiqué esto?") con una clave distinta, no una
 * rebanada de compactación: la foto no es compactable entre digests, cada uno
 * tiene su topic propio y nunca reemplaza al anterior.
 *
 * No-op silencioso si no hay clave de grupo, o si el usuario no tiene foto
 * propia — no hay nada que publicar.
 */
export async function publishAvatarIfOwn(
  groupId: string,
  currentUserId: string,
  deviceId: string,
): Promise<void> {
  const key = groupKeyBytes(groupId);
  if (!key) return;

  const propio = useUserStore.getState().getUserById(currentUserId);
  if (!propio?.avatar) return; // sin foto propia, nada que referenciar

  const digest = await digestAvatar(propio.avatar);
  const marcador = `avatar:${currentUserId}:${digest}`;
  if (staleSliceCkeys([marcador], Date.now()).length === 0) return; // ya publicada, sin cambios

  const topic = await deriveAvatarTopic(key, currentUserId, digest);
  const sealed = sealEnvelope(key, propio.avatar);
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  // No compactable: distintos digests son distintos topics, nunca se
  // reemplazan entre sí, así que no hace falta (ni corresponde) una `ckey`.
  const resultado = await sendEnvelope(topic, firmado, deviceId, false);
  if (resultado.ok) recordSlicePublished(marcador, Date.now());
}

/**
 * Trae la foto de `userId` si el digest local no coincide (o no hay foto
 * local todavía). Se llama desde `drainGroup` por cada entrada de la
 * rebanada `users` que trae `avatarDigest`.
 *
 * Si todavía no llegó al buzón (el publicador la mandó pero el sobre no
 * aterrizó, o el publicador nunca la mandó porque el usuario recién ahora la
 * está pidiendo otro miembro), no es un error: se reintenta en el próximo
 * ciclo de sync, igual que cualquier otro sobre pendiente.
 */
export async function fetchAvatarIfMissing(
  groupId: string,
  userId: string,
  avatarDigest: string,
): Promise<void> {
  const key = groupKeyBytes(groupId);
  if (!key) return;

  const local = useUserStore.getState().getUserById(userId);
  if (local?.avatarDigest === avatarDigest && local.avatar) return; // ya la tengo
  if (!local) return; // el perfil todavía no llegó por la rebanada de `users`; nada que actualizar

  const topic = await deriveAvatarTopic(key, userId, avatarDigest);
  const resultado = await fetchSince(topic, 0);
  if (!resultado.ok || resultado.envelopes.length === 0) return;

  const ultimo = resultado.envelopes[resultado.envelopes.length - 1]!;
  const abierto = verifyEnvelope(ultimo.payload);
  if (!abierto) return;
  const avatar = openEnvelope(key, abierto.sealed);
  if (!avatar) return;

  useUserStore.getState().addOrUpdateUser({ ...local, avatar, avatarDigest });
}
