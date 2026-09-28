import * as Crypto from 'expo-crypto';
import type { GroupKey } from '@/src/sync/nucleo/envelopeCrypto';
import { sealEnvelope, openEnvelope } from '@/src/sync/nucleo/envelopeCrypto';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import { signEnvelope, verifyEnvelope } from '@/src/sync/nucleo/envelopeSign';
import { sendEnvelope, fetchSince } from '../supabase/relay';
import { ensureIdentity } from '@/src/store/identityStore';
import { groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { leerCubo, registrarCubo } from '@/src/sync/nucleo/sliceLedger';
import { almacen } from './adaptadorHushSplit';
import { digestOfJson } from '@/src/sync/nucleo/manifest';
import { TIMEOUT_ENVIO_MS, RENEWAL_WINDOW_MS } from '@/src/sync/nucleo/limites';

/**
 * `ckey` fija dentro del topic de la foto propia (T-206-A D12): el topic ya
 * es único por `(clave de grupo, userId, digest)`, así que no hay sub-cubos
 * que distinguir — `leerCubo`/`registrarCubo` piden una `ckey` de todos modos
 * porque comparten forma con el ledger de cubos de datos (`publicarCubos.ts`).
 */
const AVATAR_LEDGER_CKEY = 'propia';

/**
 * Caché negativa de intentos de fetch (hallazgo #4 de la revisión de Task 9):
 * una foto que todavía no está en el buzón (el publicador no la mandó, o
 * expiró) no debe reintentarse en CADA drenaje (cada ~15min) — sólo
 * ocasionalmente, hasta que aparezca.
 *
 * T-206-A (D12): antes vivía en `sliceRenewal.ts` (MMKV, marcador
 * `avatar-attempt:...`), compartiendo storage con la renovación de rebanadas
 * que ese archivo también resolvía. Con `sliceRenewal.ts` borrado (la
 * renovación de la foto propia pasó al ledger de cubos, ver
 * `publishAvatarIfOwn` más abajo), esto queda como lo que siempre fue: un
 * freno de red, no un dato — no necesita sobrevivir un restart de la app (el
 * peor caso de perderlo es reintentar un fetch que ya sabíamos que iba a
 * fallar), así que pasa a un `Map` en memoria del módulo.
 */
const intentosDeFetch = new Map<string, number>();
const AVATAR_FETCH_RETRY_WINDOW_MS = 5 * 60 * 1000;

function fueraDeVentanaDeReintento(marcador: string, ahora: number): boolean {
  const ultimo = intentosDeFetch.get(marcador);
  return ultimo === undefined || ahora - ultimo > AVATAR_FETCH_RETRY_WINDOW_MS;
}

/**
 * T-206-A (D8): mismo valor que `PUBLICACION_TIMEOUT_MS` (`motor/publicar.ts`)
 * y `EJECUCION_TIMEOUT_MS` (`motor/relayQueue.ts`) — las tres importan
 * `TIMEOUT_ENVIO_MS` de `nucleo/limites.ts` en vez de repetir el literal.
 */
const AVATAR_TIMEOUT_MS = TIMEOUT_ENVIO_MS;

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
 * T-206-A (D12): antes la dedup vivía en `sliceRenewal.ts` (MMKV, marcador
 * propio `avatar:<userId>:<digest>`). Ahora reutiliza el MISMO ledger de
 * cubos que `nucleo/publicarCubos.ts` usa para los cubos de datos
 * (`sliceLedger.ts#leerCubo`/`registrarCubo`, con el `almacen` del
 * adaptador) — la regla es exactamente la que ya aplica
 * `publicarCubos.ts:84-87`: se publica si "cambió el digest o venció
 * `RENEWAL_WINDOW_MS`". Acá el `topic` de la foto YA es único por digest
 * (`deriveAvatarTopic`), así que `leerCubo` sobre ese topic sólo puede
 * encontrar una entrada con ESE mismo digest o ninguna — el chequeo de
 * `cambio` queda para cuando el ledger todavía no vio este digest (primera
 * vez, o tras perder el storage), y `vencido` para cuando sí lo vio pero hace
 * más de `RENEWAL_WINDOW_MS`.
 *
 * Migración: el marcador viejo de `sliceRenewal.ts` (bucket `slice-renewal`)
 * no se lee más — la primera publicación después de este cambio no encuentra
 * nada en el ledger nuevo y republica la foto una vez, aunque no haya
 * cambiado. Es inocuo (mismo mecanismo de "no reemplaza, sólo agrega" que ya
 * usa cada digest) y no se repite en publicaciones siguientes.
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
  const topic = await deriveAvatarTopic(key, currentUserId, digest);

  const ahora = Date.now();
  const entradaLedger = leerCubo(almacen, topic, deviceId, AVATAR_LEDGER_CKEY);
  const cambio = !entradaLedger || entradaLedger.digest !== digest;
  const vencido = !!entradaLedger && (ahora - entradaLedger.publicadaEn > RENEWAL_WINDOW_MS);
  if (!cambio && !vencido) return; // ya publicada, sin cambios ni vencimiento

  const sealed = sealEnvelope(key, propio.avatar);
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  // No compactable: distintos digests son distintos topics, nunca se
  // reemplazan entre sí, así que no hace falta (ni corresponde) una `ckey`
  // del lado del transporte (`sendEnvelope`) — la `ckey` del ledger de arriba
  // es un concepto aparte, interno a este módulo.
  //
  // T-191 (verifier, cuarta tanda): esta función corre DENTRO de
  // `antesDePublicar`, que desde el fix de M2 corre al turno de
  // `encolarPorTopic` (`relaySync.ts`) — un envío colgado acá trabaría la
  // cola de publicación del GRUPO, no sólo la foto. Mismo timeout + cancelación
  // real que `publishToGroup#enviar` (`AVATAR_TIMEOUT_MS`, duplicado de
  // `PUBLICACION_TIMEOUT_MS` — mismo valor, no se importa de `relaySync.ts`
  // para no cerrar un ciclo: `relaySync.ts` → `adaptadorHushSplit.ts` →
  // `avatarTopic.ts`).
  const controller = new AbortController();
  const cruda = sendEnvelope(topic, firmado, deviceId, false, undefined, controller.signal);
  const TIMEOUT = Symbol('avatar_timeout');
  const venciendo = new Promise<typeof TIMEOUT>((resolve) => {
    setTimeout(() => { controller.abort(); resolve(TIMEOUT); }, AVATAR_TIMEOUT_MS);
  });
  const resultado = await Promise.race([cruda, venciendo]);
  if (resultado !== TIMEOUT && resultado.ok) {
    registrarCubo(almacen, topic, deviceId, AVATAR_LEDGER_CKEY, digest, ahora);
  }
}

/**
 * Trae la foto de `userId` si el digest local no coincide (o no hay foto
 * local todavía). Se llama desde `drainGroup` por cada entrada de la
 * rebanada `users` que trae `avatarDigest`.
 *
 * Si todavía no llegó al buzón (el publicador la mandó pero el sobre no
 * aterrizó, o el publicador nunca la mandó porque el usuario recién ahora la
 * está pidiendo otro miembro), no es un error: se reintenta, pero no en CADA
 * drenaje — la caché negativa de abajo (`intentosDeFetch`, en memoria) lo
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
  const marcadorIntento = `${userId}:${avatarDigest}`;
  const ahora = Date.now();
  if (!fueraDeVentanaDeReintento(marcadorIntento, ahora)) return;
  intentosDeFetch.set(marcadorIntento, ahora);

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
