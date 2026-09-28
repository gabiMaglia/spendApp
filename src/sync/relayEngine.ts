import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useAuthStore } from '@/src/store/authStore';
import { deriveTopic, fromHex } from './envelopeCrypto';
import { subscribeTopic, isRelayConfigured } from './relay';
import { ensureRelaySession, haySesionEnCurso, reabrirSesionAnonima } from './relaySession';
import type { SessionKind } from './relaySession';
import { setUltimaSesionConocida } from './sessionStatus';
import { processAllInvites } from './inviteEngine';
import { processAllContactInvites } from './contactInviteEngine';
import { verifyMyKeyRegistered } from './deviceKeys';
import { withTimeout } from '@/src/utils/withTimeout';
import { deviceId } from './relay/cursor';
export { readCursor, writeCursor, olvidarCursor, deviceId } from './relay/cursor';
import { marcarCanal, olvidarCanal, startPolling, stopPolling } from './relay/poll';
export { POLL_OK_MS, POLL_CAIDO_MS, POLL_INTERVAL_MS, intervaloDePoll } from './relay/poll';
import { syncableGroupIds, cancelPendingPublishes, reintentarPublicacionesConCuota } from './relay/publish';
export { PUBLISH_DEBOUNCE_MS, syncableGroupIds, schedulePublish, publishNow, cancelPendingPublishes } from './relay/publish';
import { drainNow, scheduleDrain, cancelPendingDrains, drainAll } from './relay/drain';
export { DRAIN_DEBOUNCE_MS, drainNow, scheduleDrain, cancelPendingDrains, drainAll } from './relay/drain';
import { anunciarMiTarjeta, reenviarClavesDeGrupo, drainContactsNow } from './relay/contactos';
export { anunciarMiTarjeta, __resetReenvioClaves, announceGroupToContacts, drainContactsNow } from './relay/contactos';
import { subscribeInvites, subscribeContacts, crearOnInviteNews } from './relay/invitaciones';
import { vaciarCola } from './relayQueue';

/**
 * Motor del sync en tiempo real (fachada, T-189). Dirección fija de imports:
 * fachada → `relay/invitaciones.ts` → `relay/contactos.ts` → `relay/drain.ts`
 * → `relay/publish.ts` → `relay/poll.ts`/`relay/cursor.ts`. Ningún módulo de
 * abajo importa uno de arriba; lo único que necesita `startRelay` (definido
 * más abajo, declaración hoisteada) lo recibe como PARÁMETRO de la llamada
 * (`drainContactsNow(startRelay)`, `crearOnInviteNews(startRelay)`) — nunca
 * como estado de módulo (setter). Detalles de diseño en git log previo a
 * T-189 y en los ADR citados función por función en cada módulo.
 */

// --- ciclo de vida -------------------------------------------------------------

let unsubs: (() => void)[] = [];
/** Candado de reentrada: `startRelay` corta TODO al arrancar; si dos
 *  corridas se pisan, la de afuera gana (T-138-bis). */
let arrancando: Promise<void> | null = null;

/** `permitirCaptcha` (default `false`, T-147): sólo `rehydrateForActiveUser`
 *  puede mostrarlo; el resto arranca con el default seguro. */
export function startRelay(permitirCaptcha: boolean = false): Promise<void> {
  if (arrancando) return arrancando;
  arrancando = doStartRelay(permitirCaptcha).finally(() => { arrancando = null; });
  return arrancando;
}

/** T-138-bis: timeout único de punta a punta. */
const STARTUP_TIMEOUT_MS = 20_000;
/** T-147 (D1/D5): sesión vigente al arrancar, comparada en cada vuelta de
 *  `releerTodo` — un canal suscripto sin JWT queda afuera en silencio. */
let kindAlArrancar: SessionKind = 'none';

async function doStartRelay(permitirCaptcha: boolean): Promise<void> {
  stopRelay();
  if (!isRelayConfigured()) return;

  await withTimeout(arrancarCadenaDeSync(permitirCaptcha), STARTUP_TIMEOUT_MS, undefined);
  startPolling(releerTodo);
}

async function arrancarCadenaDeSync(permitirCaptcha: boolean): Promise<void> {
  // Verifier D5: sin usuario (login en curso) no hay grupos que sincronizar
  // — abrir sesión (y su captcha) sólo interrumpiría el login. El resto SÍ
  // corre sin usuario (T-096: invitaciones de CONTACTO no dependen de cuenta).
  if (useAuthStore.getState().currentUser) {
    // T-147 (D1): la sesión se garantiza ANTES de cualquier suscripción.
    kindAlArrancar = await ensureRelaySession(permitirCaptcha);
    if (!haySesionEnCurso()) setUltimaSesionConocida(kindAlArrancar); // R4-3
  } else {
    kindAlArrancar = 'none';
  }

  // Invitaciones PRIMERO: una que se complete acá adopta la clave del grupo
  // y recién entonces entra en `syncableGroupIds`.
  const adoptados = await processAllInvites(deviceId()).catch(() => [] as string[]);
  await processAllContactInvites(deviceId()).catch(() => false);

  for (const groupId of syncableGroupIds()) {
    const record = useGroupKeyStore.getState().getKey(groupId);
    if (!record) continue;

    try {
      const topic = await deriveTopic(fromHex(record.key), record.epoch);
      // Fix 1: debounce (`scheduleDrain`) — ADR-007 manda K+1 sobres por
      // publicación. T-158a: se siembra `false` ANTES de que `onStatus`
      // dispare — un canal mudo cuenta como "no confirmado", nunca AUSENTE.
      marcarCanal(topic, false);
      const off = subscribeTopic(topic, () => { scheduleDrain(groupId); }, (ok) => {
        marcarCanal(topic, ok);
      });
      unsubs.push(() => { off(); olvidarCanal(topic); });
    } catch { /* un grupo que falla no debe impedir los demás */ }
  }

  unsubs.push(...await subscribeInvites(invite => { void onInviteNews(invite); }));
  unsubs.push(...await subscribeContacts(() => { void drainContactsNow(startRelay); }));
  await anunciarMiTarjeta();

  void verifyMyKeyRegistered(); // sólo detecta; registrar necesita login (ver deviceKeys)
  await drainContactsNow(startRelay);
  await drainAll(); // al arrancar, lo encolado mientras estuvimos afuera

  // Un grupo recién adoptado se drena explícitamente: el usuario está
  // mirando la pantalla esperando verlo.
  for (const groupId of adoptados) await drainNow(groupId);

  await reenviarClavesDeGrupo(adoptados);
}

/**
 * Qué hacer en cada vuelta del poll de `./relay/poll.ts` (que sólo sabe
 * CUÁNDO). T-138-bis: mismo timeout total que `doStartRelay`.
 */
async function releerTodo(): Promise<void> {
  // D5: sin usuario no se pide sesión en cada vuelta (evita el captcha cada
  // 20s en login). T-147 (D1/D5): si la sesión cambió desde el arranque,
  // reinicia TODA la cadena — el poll NUNCA puede mostrar captcha.
  if (useAuthStore.getState().currentUser) {
    const kind = await ensureRelaySession(false);
    if (!haySesionEnCurso()) setUltimaSesionConocida(kind);
    if (kind !== kindAlArrancar) {
      void startRelay();
      return;
    }
  }

  await withTimeout((async () => {
    try {
      await drainContactsNow(startRelay);
      await drainAll();
      await processAllContactInvites(deviceId());
      await reintentarPublicacionesConCuota();
    } catch { /* offline: se reintenta en la próxima vuelta */ }
  })(), STARTUP_TIMEOUT_MS, undefined);
}

/** `crearOnInviteNews` recibe `startRelay` por parámetro (declaración
 *  hoisteada) para que `./relay/invitaciones.ts` no importe la fachada. */
const onInviteNews = crearOnInviteNews(startRelay);

export function stopRelay(): void {
  for (const off of unsubs) { try { off(); } catch { /* ya cortado */ } }
  unsubs = [];
  stopPolling();
  cancelPendingDrains(); // sin esto, un drenaje agendado dispararía contra un grupo ya no activo
}

/** Cambio de cuenta / logout (T-147-b), ANTES de `rehydrateForActiveUser`:
 *  corta el motor, cancela publicaciones debounced, vacía `relayQueue` y
 *  fuerza el cierre de la sesión del buzón — nada diferido de la cuenta
 *  anterior sigue saliendo. */
export function reiniciarSyncPorCambioDeCuenta(): void {
  stopRelay();
  cancelPendingPublishes();
  vaciarCola();
  void reabrirSesionAnonima();
}
