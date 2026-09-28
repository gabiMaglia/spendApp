import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { snapshot, noticesFor, type Snapshot } from '@/src/services/syncNotices';
import { announce } from '@/src/services/notifications';
import { useAuthStore } from '@/src/store/authStore';
import { deriveTopic, fromHex } from './envelopeCrypto';
import { subscribeTopic, isRelayConfigured } from './relay';
import { ensureRelaySession, haySesionEnCurso, reabrirSesionAnonima } from './relaySession';
import type { SessionKind } from './relaySession';
import { setUltimaSesionConocida } from './sessionStatus';
import { drainGroup, sigueSiendoLaClave, type PublishResult } from './relaySync';
import { noticeDeCaida } from './syncDownNotices';
import { noticeDeReloj } from './clockNotice';
import { limpiarPendienteDeDrenaje } from './pendingDrain';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { processAllInvites } from './inviteEngine';
import { processAllContactInvites } from './contactInviteEngine';
import { verifyMyKeyRegistered } from './deviceKeys';
import { withTimeout } from '@/src/utils/withTimeout';
import { readCursor, writeCursor, deviceId } from './relay/cursor';
export { readCursor, writeCursor, olvidarCursor, deviceId } from './relay/cursor';
import { marcarCanal, olvidarCanal, startPolling, stopPolling } from './relay/poll';
export { POLL_OK_MS, POLL_CAIDO_MS, POLL_INTERVAL_MS, intervaloDePoll } from './relay/poll';
import { syncableGroupIds, publishNow, cancelPendingPublishes, reintentarPublicacionesConCuota, setNotificadorDePublish } from './relay/publish';
export { PUBLISH_DEBOUNCE_MS, syncableGroupIds, schedulePublish, publishNow, cancelPendingPublishes } from './relay/publish';
import { scheduleDrain, cancelPendingDrains, drainAll, setDrainNowImpl } from './relay/drain';
export { DRAIN_DEBOUNCE_MS, scheduleDrain, cancelPendingDrains, drainAll } from './relay/drain';
import { anunciarMiTarjeta, reenviarClavesDeGrupo, setDrainPublishImpl } from './relay/contactos';
export { anunciarMiTarjeta, __resetReenvioClaves, announceGroupToContacts } from './relay/contactos';
import { subscribeInvites, subscribeContacts, crearOnInviteNews, drainContactsNow, setContactosImpl, setNotificadorDeJoined } from './relay/invitaciones';
export { drainContactsNow } from './relay/invitaciones';
import { vaciarCola } from './relayQueue';

/**
 * Motor del sync en tiempo real (fachada, T-189). Mapa: `relay/cursor.ts`
 * (cursores+deviceId), `relay/poll.ts` (poll adaptativo), `relay/publish.ts`
 * (debounce de publicación), `relay/drain.ts` (debounce/`drainAll`),
 * `relay/contactos.ts` + `relay/invitaciones.ts` (tarjeta, claves,
 * invitaciones). Detalles de diseño en git log previo a T-189 y en los ADR
 * citados función por función.
 *
 * `drainNow` y los `avisar*`/`announce()` se quedan acá (no en los módulos
 * de abajo) por tests que leen el TEXTO de este archivo — `inventarioDeAvisos.test.ts`
 * exige que sólo `services/notifications.ts` y esta fachada llamen a
 * `announce()`, y `syncNotices.test.ts` exige `export async function
 * drainNow` acá con `drainGroup(`→`antesDeAplicar:`→`snapshot(` en orden
 * (T-158b). Los módulos avisan por hooks inyectados una vez (`setNotificadorDePublish`,
 * `setDrainNowImpl`, etc.) — mismo patrón que `startPolling(releer)`.
 */
setNotificadorDePublish((groupId, result) => {
  void avisarSiDejoDeSincronizar(groupId, result);
  void avisarSiElRelojEstaMal();
});

/** T-054/T-058: anota en la bandeja cuando un grupo dejó de sincronizar. */
async function avisarSiDejoDeSincronizar(groupId: string, result: PublishResult): Promise<void> {
  try {
    const grupo = useGroupStore.getState().groups.find(g => g.id === groupId);
    const aviso = noticeDeCaida(groupId, grupo?.name ?? '', result);
    if (aviso) await announce([aviso]);
  } catch { /* nunca rompe la publicación */ }
}

/** ADR-005/T-054: avisa si el reloj del teléfono está desfasado. */
async function avisarSiElRelojEstaMal(): Promise<void> {
  try {
    const aviso = noticeDeReloj();
    if (aviso) await announce([aviso]);
  } catch { /* nunca rompe la publicación */ }
}

// --- drenaje -----------------------------------------------------------------

setDrainNowImpl(drainNow);
setDrainPublishImpl({ drainNow, publishNow });
setContactosImpl({ drainNow, startRelay });
/** `kind: 'joined'` se queda acá — mismo motivo que `avisarDeLoNuevo`. */
setNotificadorDeJoined(groupIds => {
  void announce(groupIds.map(groupId => ({
    kind: 'joined' as const,
    groupId,
    groupName: useGroupStore.getState().getById(groupId)?.name ?? '',
  })).filter(n => n.groupName !== ''));
});

/**
 * Baja y aplica lo pendiente de un grupo. El cursor se persiste DESPUÉS de
 * aplicar (si muriera antes, esos sobres no se volverían a pedir).
 */
export async function drainNow(groupId: string): Promise<number> {
  const userId = useAuthStore.getState().currentUser?.id;
  const record = useGroupKeyStore.getState().getKey(groupId);
  if (!userId || !record) return 0;

  // T-158b: la foto previa se toma PEREZOSAMENTE, sólo si `drainGroup`
  // encuentra algo que aplicar — la mayoría de las vueltas no traen nada.
  let antes: Snapshot | undefined;

  try {
    const topic = await deriveTopic(fromHex(record.key), record.epoch);
    const r = await drainGroup(groupId, userId, deviceId(), readCursor(topic), {
      antesDeAplicar: () => {
        antes = snapshot(useExpenseStore.getState().expenses, syncedNow(),
          useGroupStore.getState().groups, usePaymentStore.getState().payments);
      },
    });
    if (!r.ok) return 0;
    // T-136 · D-1: clave cambiada mientras esperaba => cursor del topic viejo.
    if (!sigueSiendoLaClave(groupId, record)) return 0;
    // T-146: `drainGroup` no devuelve un cursor por encima de una rebanada fallida.
    writeCursor(topic, r.cursor);
    // T-089: sólo se limpia con el buzón leído hasta el final (`r.completo`).
    if (r.completo) limpiarPendienteDeDrenaje(groupId);
    if (r.applied > 0) applyApprovedLeaves();
    // T-010: `antes` siempre está seteado si `r.applied > 0` (ver `antesDeAplicar`).
    if (r.applied > 0 && antes) void avisarDeLoNuevo(antes, userId);
    return r.applied;
  } catch {
    return 0; // offline: se reintenta al próximo arranque o aviso
  }
}

/** T-010: avisa de lo que llegó en esta bajada, sin frenar el sync si falla. */
async function avisarDeLoNuevo(antes: Snapshot, userId: string): Promise<void> {
  try {
    const avisos = noticesFor(antes, useExpenseStore.getState().expenses, useGroupStore.getState().groups,
      userId, syncedNow(), usePaymentStore.getState().payments);
    if (avisos.length > 0) await announce(avisos);
  } catch { /* nunca rompe el sync */ }
}

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
  unsubs.push(...await subscribeContacts(() => { void drainContactsNow(); }));
  await anunciarMiTarjeta();

  void verifyMyKeyRegistered(); // sólo detecta; registrar necesita login (ver deviceKeys)
  await drainContactsNow();
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
      await drainContactsNow();
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
