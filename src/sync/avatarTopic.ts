import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex, sealEnvelope, openEnvelope } from './envelopeCrypto';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { sendEnvelope, fetchSince } from './relay';
import { ensureIdentity } from '@/src/store/identityStore';
import { groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { recordSlicePublished, staleSliceCkeys } from './sliceRenewal';
import { digestOfJson } from './manifest';

/**
 * Ventana de la caché negativa de intentos de fetch (hallazgo #4 de la
 * revisión de Task 9): una foto que todavía no está en el buzón (el
 * publicador no la mandó, o expiró) no debe reintentarse en CADA drenaje
 * (cada ~15min) — sólo ocasionalmente, hasta que aparezca.
 */
const AVATAR_FETCH_RETRY_WINDOW_MS = 5 * 60 * 1000;

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

  const digest = await digestOfJson(propio.avatar);
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
 * está pidiendo otro miembro), no es un error: se reintenta, pero no en CADA
 * drenaje — la caché negativa de abajo (marcador `avatar-attempt:...`) lo
 * espacía a lo sumo cada `AVATAR_FETCH_RETRY_WINDOW_MS`.
 *
 * **Hallazgo #1 de la revisión (Critical):** el guard de "¿ya la tengo?" NO
 * puede comparar contra `local.avatarDigest`. Para cuando esta función corre
 * dentro de `drainGroup`, la rebanada `users` YA se mergeó (`applyDelta` →
 * `mergeUsersLWW`, que reemplaza el registro entero) — así que
 * `local.avatarDigest` YA es el digest NUEVO que acaba de llegar, mientras
 * que `local.avatar` sigue teniendo los bytes VIEJOS (la foto nunca viaja en
 * esa rebanada). Comparar `avatarDigest` (parámetro) contra
 * `local.avatarDigest` da un empate trivial siempre, y la foto nueva nunca se
 * pide. La comparación correcta es contra el digest de los bytes que
 * REALMENTE están cacheados en `local.avatar` — recalculado acá con la MISMA
 * función que usa el lado de publicación (`digestOfJson`, consolidada en
 * `manifest.ts` — antes había una `digestAvatar` propia en este archivo,
 * bytealmente idéntica pero duplicada; hallazgo M1 de la revisión).
 */
export async function fetchAvatarIfMissing(
  groupId: string,
  userId: string,
  avatarDigest: string,
): Promise<void> {
  const key = groupKeyBytes(groupId);
  if (!key) return;

  const local = useUserStore.getState().getUserById(userId);
  if (!local) return; // el perfil todavía no llegó por la rebanada de `users`; nada que actualizar

  const digestDeBytesCacheados = local.avatar ? await digestOfJson(local.avatar) : undefined;
  if (digestDeBytesCacheados === avatarDigest) return; // los bytes que ya tengo son estos mismos

  // Caché negativa (hallazgo #4): si el último intento de pedir ESTA MISMA
  // versión (userId+digest) fue hace menos de la ventana corta, no se
  // reintenta todavía — evita machacar la red cada ~15min con un fetch que ya
  // sabemos que puede fallar (foto aún no publicada, o expirada).
  const marcadorIntento = `avatar-attempt:${userId}:${avatarDigest}`;
  if (staleSliceCkeys([marcadorIntento], Date.now(), AVATAR_FETCH_RETRY_WINDOW_MS).length === 0) return;
  recordSlicePublished(marcadorIntento, Date.now());

  const topic = await deriveAvatarTopic(key, userId, avatarDigest);
  const resultado = await fetchSince(topic, 0);
  if (!resultado.ok || resultado.envelopes.length === 0) return; // sigue pendiente; se reintenta pasada la ventana

  const ultimo = resultado.envelopes[resultado.envelopes.length - 1]!;
  const abierto = verifyEnvelope(ultimo.payload);
  if (!abierto) return;
  const avatar = openEnvelope(key, abierto.sealed);
  if (!avatar) return;

  useUserStore.getState().addOrUpdateUser({ ...local, avatar, avatarDigest });
}
