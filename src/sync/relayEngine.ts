import { createSecureStorage } from '@/src/utils/secureStorage';
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
import { estaPendienteDeDrenaje, limpiarPendienteDeDrenaje } from './pendingDrain';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { deriveInviteTopic, type GroupInvite } from './groupInvite';
import { activeInvites, processInvite, processAllInvites } from './inviteEngine';
import { processAllContactInvites } from './contactInviteEngine';
import { avisarConflictosDelDrenaje } from './keyConflictNotice';
import { verifyMyKeyRegistered } from './deviceKeys';
import { withTimeout } from '@/src/utils/withTimeout';
import { readCursor, writeCursor, deviceId } from './relay/cursor';
export { readCursor, writeCursor, olvidarCursor, deviceId } from './relay/cursor';
import { marcarCanal, olvidarCanal, startPolling, stopPolling } from './relay/poll';
export { POLL_OK_MS, POLL_CAIDO_MS, POLL_INTERVAL_MS, intervaloDePoll } from './relay/poll';
import {
  syncableGroupIds, publishNow, cancelPendingPublishes, reintentarPublicacionesConCuota, setNotificadorDePublish,
} from './relay/publish';
export {
  PUBLISH_DEBOUNCE_MS, syncableGroupIds, schedulePublish, publishNow, cancelPendingPublishes,
} from './relay/publish';
import { scheduleDrain, cancelPendingDrains, drainAll, setDrainNowImpl } from './relay/drain';
export { DRAIN_DEBOUNCE_MS, scheduleDrain, cancelPendingDrains, drainAll } from './relay/drain';

/** T-138-bis: ver `anunciarMiTarjeta`. */
const ANUNCIO_TIMEOUT_MS = 8_000;
import {
  ensureContactSecret, deriveContactTopic, drainContacts, sendGroupKeyResultado,
  announceCardResultado, listPeers, myContactCard, cardFingerprint,
  cardYaEnviada, marcarCardEnviada,
} from './contactChannel';
import { encolar, vaciarCola } from './relayQueue';

/**
 * Motor del sync en tiempo real: publica lo que cambia y aplica lo que llega.
 *
 * Es la parte que convierte las piezas sueltas en la promesa del producto —
 * "creo un gasto y lo ven al instante" — y por eso concentra las decisiones
 * incómodas:
 *
 *  - **El cursor se persiste**, no vive en memoria. Si se reiniciara en cada
 *    arranque, cada apertura de la app volvería a bajar y re-aplicar toda la
 *    cola. Funciona (el merge es idempotente) pero desperdicia batería y datos
 *    en algo que ya se hizo.
 *  - **Publicar va con debounce.** Cargar un gasto dispara varios cambios de
 *    store seguidos; sin agrupar, se manda un sobre por cada uno y se quema la
 *    cuota del relay con estados intermedios que nadie va a leer.
 *  - **Nada de esto puede tirar.** Es una app offline-first: sin relay, sin
 *    internet o sin clave de grupo, todo tiene que seguir funcionando local.
 */

const storage = createSecureStorage('groupkeys');

/**
 * `./relay/publish.ts` no llama a `announce()` directamente — se lo avisa a
 * ESTOS dos, registrados una sola vez acá. `inventarioDeAvisos.test.ts` exige
 * que sólo `services/notifications.ts` y esta fachada contengan esa llamada;
 * mismo patrón que `startPolling(releer)` en `./relay/poll.ts`, para no hacer
 * que el módulo de publicación importe el dominio "hacia arriba".
 */
setNotificadorDePublish((groupId, result) => {
  void avisarSiDejoDeSincronizar(groupId, result);
  void avisarSiElRelojEstaMal();
});

/**
 * Anotar el fallo lo hace visible SÓLO para quien entra a ese grupo. Esto es lo
 * que hace que el usuario se entere sin entrar — que es el punto: si no abrís el
 * grupo, no te enterás de que tus gastos no le están llegando a nadie.
 *
 * Va sin `await` y envuelto: un aviso que no sale es una molestia, una
 * publicación que se cae por un aviso es un bug.
 */
async function avisarSiDejoDeSincronizar(groupId: string, result: PublishResult): Promise<void> {
  try {
    const grupo = useGroupStore.getState().groups.find(g => g.id === groupId);
    const aviso = noticeDeCaida(groupId, grupo?.name ?? '', result);
    if (aviso) await announce([aviso]);
  } catch { /* nunca rompe la publicación */ }
}

/**
 * El desfase se acaba de actualizar con la respuesta del servidor (ADR-005), así
 * que éste es el momento en que se sabe. Va acá y no en `relay.ts` a propósito:
 * ese módulo no importa nada del dominio ni nada nativo, y meterle la bandeja de
 * avisos rompería la deuda que paga desde T-054.
 */
async function avisarSiElRelojEstaMal(): Promise<void> {
  try {
    const aviso = noticeDeReloj();
    if (aviso) await announce([aviso]);
  } catch { /* nunca rompe la publicación */ }
}

// --- drenaje -----------------------------------------------------------------

/**
 * `./relay/drain.ts` sólo sabe CUÁNDO drenar (debounce, `drainAll`) — el
 * `drainNow` real se queda acá y se le inyecta, mismo patrón que
 * `setNotificadorDePublish` más arriba. Dos motivos, los dos por un test que
 * lee el TEXTO de este archivo: `syncNotices.test.ts` exige que
 * `export async function drainNow` esté acá, con `drainGroup(` envolviendo a
 * `antesDeAplicar:` y éste a `snapshot(` (T-158b) — y `avisarDeLoNuevo`, que
 * llama a `announce()`, tiene la misma restricción que en `publish.ts`
 * (`inventarioDeAvisos.test.ts`).
 */
setDrainNowImpl(drainNow);

/**
 * Baja y aplica lo pendiente de un grupo.
 * El cursor se persiste DESPUÉS de aplicar: si se guardara antes y la app
 * muriera en el medio, esos sobres no se volverían a pedir nunca.
 */
export async function drainNow(groupId: string): Promise<number> {
  const userId = useAuthStore.getState().currentUser?.id;
  const record = useGroupKeyStore.getState().getKey(groupId);
  if (!userId || !record) return 0;

  // Foto previa: es lo que distingue "llegó recién" de "ya estaba". Sin esto
  // cada relectura por cursor volvería a avisar lo mismo.
  //
  // T-158b: se toma PEREZOSAMENTE — sólo si `drainGroup` de verdad encuentra
  // algo que aplicar (`opts.antesDeAplicar`). Calcularla es trabajo de JS
  // sobre potencialmente miles de gastos, y la inmensa mayoría de las vueltas
  // de poll en un grupo tranquilo no traen un solo sobre nuevo — tirarla a la
  // basura en esos casos es puro desperdicio.
  let antes: Snapshot | undefined;

  try {
    const topic = await deriveTopic(fromHex(record.key), record.epoch);
    const r = await drainGroup(groupId, userId, deviceId(), readCursor(topic), {
      antesDeAplicar: () => {
        antes = snapshot(
          useExpenseStore.getState().expenses,
          syncedNow(),
          useGroupStore.getState().groups,
          usePaymentStore.getState().payments,
        );
      },
    });
    if (!r.ok) return 0;

    // T-136 · D-1: si la clave cambió desde la foto de entrada (el usuario
    // eligió otra mientras esto esperaba), este cursor es del topic viejo y
    // la marca de pendiente es del topic NUEVO: no se escribe uno ni se
    // limpia la otra. El drenaje que lanzó la elección se ocupa del real.
    if (!sigueSiendoLaClave(groupId, record)) return 0;

    // Siempre a la altura de lo ya aplicado (o intentado 3 veces): `drainGroup`
    // no devuelve un cursor por encima de una rebanada que falló (T-146).
    writeCursor(topic, r.cursor);

    /**
     * La marca de T-089 se limpia sólo si el buzón se leyó **hasta el final**:
     * este teléfono ya sabe lo que el grupo sabe, así que puede volver a
     * publicar. Se limpia **aunque `r.applied` sea 0** — un buzón vacío es una
     * respuesta válida. Lo que no puede limpiarla es un drenaje que falló (el
     * `if (!r.ok)` de arriba) ni uno que dejó páginas o una rebanada fallida
     * por delante (`completo: false`, T-146): publicar con estado incompleto
     * es exactamente la resurrección que T-089 cierra. El grupo espera a la
     * próxima vuelta; nada se pierde, se posterga.
     */
    if (r.completo) limpiarPendienteDeDrenaje(groupId);

    if (r.applied > 0) {
      applyApprovedLeaves();
    }

    // T-010.
    // `antes` siempre está seteado acá: `r.applied > 0` sólo es posible si
    // `drainGroup` aplicó al menos una rebanada, y eso no pasa sin haber
    // llamado antes a `antesDeAplicar` (ver el comentario en `relaySync.ts`).
    if (r.applied > 0 && antes) void avisarDeLoNuevo(antes, userId);

    return r.applied;
  } catch {
    return 0; // offline: se reintenta al próximo arranque o aviso
  }
}

/**
 * Avisa de lo que llegó en esta bajada. No puede tirar ni frenar el sync: una
 * notificación que no sale es una molestia, un sync caído es un bug.
 */
async function avisarDeLoNuevo(antes: Snapshot, userId: string): Promise<void> {
  try {
    const avisos = noticesFor(
      antes,
      useExpenseStore.getState().expenses,
      useGroupStore.getState().groups,
      userId,
      syncedNow(),
      usePaymentStore.getState().payments,
    );
    if (avisos.length > 0) await announce(avisos);
  } catch { /* nunca rompe el sync */ }
}

// --- suscripción -------------------------------------------------------------

let unsubs: (() => void)[] = [];

/**
 * Escucha los avisos de todos los grupos. El aviso NO trae el sobre: sólo
 * dispara una lectura por cursor, que es la única fuente de verdad. Si el
 * websocket estuvo caído, la lectura recupera igual lo que se perdió.
 */
/**
 * Reentrada: `startRelay` se llama desde varios lados (arranque, cambio de
 * cuenta, alta de invitación, adopción de clave) y arranca cortando TODO. Si
 * dos corridas se pisan, la segunda desuscribe lo que la primera acaba de
 * crear. El candado hace que la de afuera gane y la de adentro se descarte.
 */
let arrancando: Promise<void> | null = null;

/**
 * `permitirCaptcha` (default `false`, BUG T-147 post-merge): sólo la entrada
 * real (`session.ts::rehydrateForActiveUser`, que corre exactamente en la
 * hidratación inicial y en cada cambio de cuenta) debe poder mostrar el
 * captcha. Todos los demás llamadores (join de grupo, alta de contacto,
 * adopción de clave, y el reinicio que hace el propio poll cuando la sesión
 * cambió) arrancan con el default seguro.
 */
export function startRelay(permitirCaptcha: boolean = false): Promise<void> {
  if (arrancando) return arrancando;
  arrancando = doStartRelay(permitirCaptcha).finally(() => { arrancando = null; });
  return arrancando;
}

/**
 * T-138-bis: la cadena entera, de punta a punta, con UN límite de tiempo
 * total — no uno por cada `await` suelto.
 *
 * El timeout puntual en `processAllInvites`/`processAllContactInvites`
 * (arriba) arregló UN cuelgue real, pero no el único: la cadena sigue
 * teniendo media docena de `await`s de red sin protección (`subscribeContacts`,
 * `anunciarMiTarjeta`, `drainContactsNow`, `drainAll`, `drainNow`,
 * `reenviarClavesDeGrupo`), y cualquiera de ellos que se cuelgue deja
 * `startPolling()` sin arrancar NUNCA — que es lo único que reintentaría
 * solo. Parchear uno por uno es whack-a-mole; la garantía real tiene que
 * estar en el borde de afuera: pase lo que pase adentro, `startPolling()`
 * se llama sí o sí antes de `STARTUP_TIMEOUT_MS`.
 */
const STARTUP_TIMEOUT_MS = 20_000;

/**
 * T-147 (D1/D5): qué sesión de Supabase había cuando arrancó la cadena. Se
 * compara en cada vuelta de `releerTodo` — un canal privado (Broadcast) que se
 * suscribió sin JWT queda afuera para siempre y en silencio, así que si la
 * sesión cambió (captcha resuelto tarde, login con Google mientras corría,
 * sesión perdida) hay que resuscribir con la nueva, no seguir con la vieja.
 */
let kindAlArrancar: SessionKind = 'none';

async function doStartRelay(permitirCaptcha: boolean): Promise<void> {
  stopRelay();
  if (!isRelayConfigured()) return;

  await withTimeout(arrancarCadenaDeSync(permitirCaptcha), STARTUP_TIMEOUT_MS, undefined);
  startPolling(releerTodo);
}

async function arrancarCadenaDeSync(permitirCaptcha: boolean): Promise<void> {
  /**
   * Verifier D5: sin usuario activo (pantalla de login, antes de elegir
   * Google/Apple/invitado) no hay ningún GRUPO que sincronizar todavía
   * (`syncableGroupIds()` ya exige `currentUser`, un poco más abajo) — abrir
   * una sesión acá (y su captcha) sólo interrumpiría el login sin necesidad.
   * En cuanto el usuario elige cualquier opción, `setUser` dispara un
   * `startRelay` nuevo con `currentUser` ya puesto, y ahí sí corresponde.
   *
   * El resto de la cadena SÍ sigue corriendo sin usuario (T-096: invitaciones
   * de CONTACTO no dependen de tener una cuenta elegida) — sólo se salta el
   * paso que abre sesión y que puede mostrar captcha.
   *
   * No se toca `sessionStatus`: no es "sin sesión", es "todavía no hace falta
   * ninguna" — no tiene que avisar nada en pantalla.
   */
  if (useAuthStore.getState().currentUser) {
    // T-147 (D1): la sesión se garantiza ANTES de cualquier suscripción. Un
    // canal privado que se une sin JWT queda afuera sin ningún error visible
    // — el orden acá no es un detalle.
    kindAlArrancar = await ensureRelaySession(permitirCaptcha);
    // Verifier R4-3: `setUser` dispara este `startRelay` ANTES de que
    // `entrarAlDirectorio` alcance a llamar a `signIntoDirectory`
    // (`auth/index.tsx:302-309` para Google, `:300-309` para Apple) — la
    // PRIMERA lectura de sesión de un login que en realidad va a salir bien
    // casi siempre ve "todavía no hay nada" (`'none'`). Si en este instante
    // hay OTRA operación de sesión en vuelo (el login, encolado detrás de
    // esta misma lectura), no se reporta nada: se deja el estado visible
    // anterior en vez de mostrar «Reconectar» sobre un login que está por
    // resolverse solo.
    if (!haySesionEnCurso()) setUltimaSesionConocida(kindAlArrancar);
  } else {
    kindAlArrancar = 'none';
  }

  // Las invitaciones se resuelven PRIMERO: una que se complete acá adopta la
  // clave del grupo, y recién con esa clave el grupo entra en `syncableGroupIds`
  // y se puede suscribir abajo. Al revés habría que esperar al próximo arranque.
  const adoptados = await processAllInvites(deviceId()).catch(() => [] as string[]);
  await processAllContactInvites(deviceId()).catch(() => false);

  for (const groupId of syncableGroupIds()) {
    const record = useGroupKeyStore.getState().getKey(groupId);
    if (!record) continue;

    try {
      const topic = await deriveTopic(fromHex(record.key), record.epoch);
      // Fix 1: agendado con debounce (no `drainNow` directo) — ver
      // `scheduleDrain` para por qué un aviso realtime por sobre individual
      // no puede disparar un drenaje inmediato con ADR-007 en juego.
      // T-158a: además del aviso, se registra el estado del canal privado —
      // es lo que decide el intervalo del próximo poll (`intervaloDePoll`).
      //
      // Observación del verificador ciego: se siembra `false` ACÁ, antes de
      // que `onStatus` dispare por primera vez — un canal recién suscripto
      // que todavía no confirmó nada (mudo, nunca llegó `SUBSCRIBED` ni
      // `CHANNEL_ERROR`) tiene que contar como "no confirmado", nunca quedar
      // AUSENTE del mapa: ausente es indistinguible de "no hay canales", y con
      // otro canal ya en `true`, `intervaloDePoll` prometía 90s sin que este
      // hubiera confirmado nada.
      marcarCanal(topic, false);
      const off = subscribeTopic(topic, () => { scheduleDrain(groupId); }, (ok) => {
        marcarCanal(topic, ok);
      });
      unsubs.push(() => { off(); olvidarCanal(topic); });
    } catch { /* un grupo que falla no debe impedir los demás */ }
  }

  await subscribeInvites();
  await subscribeContacts();
  await anunciarMiTarjeta();

  // ¿Quedó registrada la clave de este aparato? Sólo se detecta; registrarla
  // necesita un login, y esa decisión es del usuario (ver deviceKeys).
  void verifyMyKeyRegistered();
  await drainContactsNow();
  await drainAll(); // al arrancar, lo encolado mientras estuvimos afuera

  // Un grupo recién adoptado no estaba en la cola de arriba cuando se drenó,
  // así que se drena explícitamente: es justo el caso en el que el usuario está
  // mirando la pantalla esperando ver el grupo aparecer.
  for (const groupId of adoptados) await drainNow(groupId);

  await reenviarClavesDeGrupo(adoptados);
}

// --- relectura periódica ------------------------------------------------------

/**
 * Qué hacer en cada vuelta del poll de `./relay/poll.ts` — ese módulo sólo
 * sabe CUÁNDO disparar (el intervalo adaptativo); esto decide QUÉ hacer,
 * porque necesita sesión, drenaje e invitaciones, que `poll.ts` no importa.
 */
async function releerTodo(): Promise<void> {
  /**
   * D5: mismo motivo que en `arrancarCadenaDeSync` — sin usuario todavía
   * (login en curso) pedir sesión en cada vuelta de poll era justo lo que
   * hacía reaparecer el captcha cada 20s sobre esa pantalla. El resto de la
   * vuelta (contactos, invitaciones) sigue corriendo igual.
   */
  if (useAuthStore.getState().currentUser) {
    // T-147 (D1/D5): si la sesión cambió desde que arrancamos —captcha
    // resuelto tarde, login con Google mientras corría, sesión perdida— los
    // canales privados quedaron suscriptos con el JWT viejo (o sin ninguno).
    // Reiniciar TODA la cadena es más simple y más seguro que intentar
    // resuscribir sólo los canales: vuelve a correr `arrancarCadenaDeSync`
    // de punta a punta.
    // BUG (T-147 post-merge): el poll NUNCA puede mostrar captcha — es
    // exactamente lo que hacía saltar el cartel "en cualquier momento".
    const kind = await ensureRelaySession(false);
    // Verifier R4-3: mismo criterio que en `arrancarCadenaDeSync` — un poll
    // que coincide con un login/logout en vuelo no pisa el estado visible.
    if (!haySesionEnCurso()) setUltimaSesionConocida(kind);
    if (kind !== kindAlArrancar) {
      void startRelay();
      return;
    }
  }

  // T-138-bis: mismo límite de tiempo total que `doStartRelay` — un poll
  // colgado no debe bloquear el siguiente (el `setInterval` ya dispara el
  // próximo solo, pero sin esto la promesa colgada queda viva para siempre).
  await withTimeout((async () => {
    try {
      await drainContactsNow();
      await drainAll();
      await processAllContactInvites(deviceId());
      await reintentarPublicacionesConCuota();
    } catch { /* offline: se reintenta en la próxima vuelta */ }
  })(), STARTUP_TIMEOUT_MS, undefined);
}

/**
 * Reparte la tarjeta propia a TODOS los contactos conocidos.
 *
 * Corre en DOS momentos, y los dos hacen falta:
 *
 *  1. Al cambiarse el nombre, para que llegue en el acto.
 *  2. **En cada arranque**, porque el punto 1 es un disparo único: si ese envío
 *     falló —sin red, o el sobre no entró— el nombre nuevo no se reintentaba
 *     NUNCA y el otro se quedaba con el viejo para siempre. Este es el mismo
 *     modo de falla silenciosa que ya nos mordió con las claves de grupo.
 *
 * Reemplaza al viejo `completarContactos`, que sólo le escribía a los contactos
 * INCOMPLETOS: un contacto completo es justamente el que se quedaba con el
 * nombre viejo. Sigue reparando lo que reparaba aquél —quien recibe una tarjeta
 * con claves que no tenía responde con la suya— porque es un superconjunto.
 *
 * Es además el único camino hacia los contactos con los que no se comparte
 * ningún grupo: a esos el delta de grupo nunca los alcanza.
 *
 * Cuesta un sobre chico por contacto por arranque. Se paga con gusto: la
 * alternativa demostró ser "el dato no llega y nadie se entera".
 */
/**
 * Verifier R4-2 (ronda 4): el PoC combinaba 13 tarjetas + 11 claves en el
 * mismo minuto de cuota — con las tarjetas mandándose en un loop directo
 * (fuera de `relayQueue`), competían por la misma cuota del uid sin ningún
 * ritmo, empujando a las claves (que sí pasaban por la cola) a agotar su
 * cupo. Ahora las tarjetas también encolan, prioridad `normal` (nadie está
 * esperando activamente un contacto reparado, a diferencia de una clave de
 * grupo nueva).
 */
export async function anunciarMiTarjeta(): Promise<void> {
  const card = myContactCard();
  if (!card) return;
  const huella = cardFingerprint(card);
  // T-147 (punto 4, simplificación): el DUEÑO de este trabajo se fija ACÁ, al
  // encolar — igual que la tarjeta de arriba. Si la cuenta activa cambia
  // antes de que el trabajo corra, se descarta sin mandar nada: la tarjeta
  // de la cuenta anterior nunca sale con la sesión de la nueva.
  const owner = useAuthStore.getState().currentUser?.id ?? null;

  for (const [userId, peer] of Object.entries(listPeers())) {
    if (!peer.secret) continue;
    // Ya tiene esta versión: no se le manda nada. Es lo que hace que el costo
    // converja a CERO cuando no cambió nada, en vez de un sobre por contacto
    // por arranque para siempre.
    if (cardYaEnviada(userId, huella)) continue;

    const secret = peer.secret;
    encolar({
      prioridad: 'normal',
      ejecutar: async () => {
        if ((useAuthStore.getState().currentUser?.id ?? null) !== owner) return 'descartar';
        try {
          const r = await withTimeout(
            announceCardResultado(card, secret, deviceId()),
            ANUNCIO_TIMEOUT_MS,
            { ok: false, reason: 'network' } as const,
          );
          if (r.ok) { marcarCardEnviada(userId, huella); return 'hecho'; }
          if (r.reason === 'rate_limited') return 'reintentar_cuota';
          return r.reason === 'network' ? 'reintentar' : 'descartar';
        } catch {
          return 'reintentar';
        }
      },
    });
  }
}

/**
 * Reenvía la clave de cada grupo propio a los contactos que son miembros.
 *
 * Es el reintento del reparto: si cuando se creó el grupo todavía no
 * conocíamos las públicas del otro, la entrega no salió y NADA volvía a
 * dispararla. Adoptar una clave que ya se tiene es un no-op, así que repetirlo
 * no cuesta nada más que unos pocos bytes por arranque.
 *
 * **Verifier D4: cooldown contra la cuota (20 sobres/min, 011a).** Esto corre
 * en CADA `startRelay()`, y este mismo ticket agrega reinicios nuevos (D1/D2:
 * el motor se reinicia entero si la sesión cambió entre vueltas). Sin freno,
 * un grupo de M miembros manda M-1 sobres por reinicio — con varios grupos
 * medianos y dos o tres reinicios seguidos durante un login normal (sesión
 * `none` → anónima → identidad), el total puede acercarse o pasar la cuota
 * SÓLO con esto, sin que el usuario haya tocado nada.
 *
 * Medido (peor caso realista, sin cooldown): 5 grupos de 8 miembros cada uno
 * = 5 × 7 = 35 sobres por `startRelay()`. Dos reinicios en el mismo minuto
 * (nada raro durante un login) ⇒ 70 sobres/min, **por encima** de las 20/min
 * de `relay_quota_config`. El cooldown de acá lo acota a UN reenvío real cada
 * `REENVIO_CLAVES_COOLDOWN_MS`, sea cual sea la cantidad de reinicios: no
 * cuesta nada perderse un reintento en ese lapso — el mismo reenvío se hace
 * de nuevo apenas se cumple.
 *
 * **Ronda 2 (ruling del orquestador): el cooldown solo no alcanza.** Frena
 * las REPETICIONES entre arranques, pero la ráfaga de UN SOLO arranque
 * (`relayQueue.ts` documenta la medición completa: 3×4→9, 5×5→20, 5×8→35
 * sobres) no tenía ningún ritmo — para 5×8 eso es 35 sobres de una, contra
 * una cuota de 20/min. Cada sobre se encola por `relayQueue` (≤15/min,
 * medido) en vez de mandarse en el loop directo: los grupos recién
 * ADOPTADOS en este mismo arranque van con prioridad `alta` (alguien está
 * esperando activamente entrar), el resto es reenvío de rutina (`normal`).
 * Un `rate_limited` de `sendGroupKeyResultado` no se descarta: la cola lo
 * reintenta sola, sin acción del usuario.
 */
const REENVIO_CLAVES_COOLDOWN_MS = 5 * 60_000;
let ultimoReenvioClaves = 0;

/**
 * **Verifier R3-3(c): la prioridad `alta` sobrevive a matar la app.**
 * `relayQueue` vive sólo en memoria — lo pendiente se regenera solo en el
 * próximo arranque en frío (aceptado), pero ese arranque nuevo sólo conoce
 * los `adoptados` de ESE momento: un grupo adoptado hace 2 minutos, cuya
 * clave no llegó a salir porque la app se cerró antes, perdía la prioridad
 * al regenerarse — pasaba a competir en la cola `normal` como cualquier
 * reenvío de rutina. Se persiste qué grupos siguen "recién adoptados" (TTL
 * generoso: no hace falta borrar apenas se entrega, sólo que no quede
 * marcado para siempre) en el mismo bucket cifrado que ya guarda los
 * cursores — nada nuevo que journalear.
 */
const ADOPCION_ALTA_PRIORIDAD_TTL_MS = 24 * 60 * 60_000;
const ADOPCION_ALTA_PRIORIDAD_KEY = 'adopciones_alta_prioridad';

function leerAdopcionesRecientes(): Record<string, number> {
  const raw = storage.getString(ADOPCION_ALTA_PRIORIDAD_KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Marca uno o más grupos como "recién adoptados" — prioridad alta hasta que
 *  venza el TTL, sobreviva o no un reinicio del proceso. */
function marcarAdopciones(ids: string[]): void {
  if (ids.length === 0) return;
  const actuales = leerAdopcionesRecientes();
  const ahora = Date.now();
  for (const id of ids) actuales[id] = ahora;
  storage.set(ADOPCION_ALTA_PRIORIDAD_KEY, JSON.stringify(actuales));
}

/** Grupos con prioridad alta vigente — poda perezosamente los vencidos. */
function gruposConPrioridadAlta(): Set<string> {
  const actuales = leerAdopcionesRecientes();
  const ahora = Date.now();
  const entradas = Object.entries(actuales);
  const vigentes = entradas.filter(([, t]) => ahora - t < ADOPCION_ALTA_PRIORIDAD_TTL_MS);
  if (vigentes.length !== entradas.length) {
    storage.set(ADOPCION_ALTA_PRIORIDAD_KEY, JSON.stringify(Object.fromEntries(vigentes)));
  }
  return new Set(vigentes.map(([id]) => id));
}

/** Sólo tests. */
export function __resetReenvioClaves(): void {
  ultimoReenvioClaves = 0;
  storage.delete(ADOPCION_ALTA_PRIORIDAD_KEY);
}

async function reenviarClavesDeGrupo(adoptados: string[] = []): Promise<void> {
  const me = useAuthStore.getState().currentUser;
  if (!me) return;
  // T-147 (punto 4, simplificación): mismo criterio que `anunciarMiTarjeta`
  // — el dueño se fija al encolar, y se revalida al ejecutar.
  const owner = me.id;
  marcarAdopciones(adoptados); // conserva la prioridad aunque el próximo arranque no los "adopte" de nuevo
  if (Date.now() - ultimoReenvioClaves < REENVIO_CLAVES_COOLDOWN_MS) return;
  ultimoReenvioClaves = Date.now();

  const prioridadAlta = gruposConPrioridadAlta();
  const ids = syncableGroupIds();
  for (const groupId of ids) {
    const group = useGroupStore.getState().getById(groupId);
    if (!group) continue;

    const prioridad = prioridadAlta.has(groupId) ? 'alta' : 'normal';
    for (const memberId of group.memberIds) {
      if (memberId === me.id) continue;
      encolar({
        prioridad,
        ejecutar: async () => {
          if ((useAuthStore.getState().currentUser?.id ?? null) !== owner) return 'descartar';
          try {
            const r = await sendGroupKeyResultado(memberId, group, deviceId());
            if (r.ok) return 'hecho';
            // R4-2: `rate_limited` NO es un fallo permanente — es "todavía
            // no", y cuenta contra un tope de horas, no de ~32s (ver
            // `relayQueue.ts`).
            if (r.reason === 'rate_limited') return 'reintentar_cuota';
            return r.reason === 'network' ? 'reintentar' : 'descartar';
          } catch {
            return 'reintentar';
          }
        },
      });
    }
  }
}

/**
 * Escucha los buzones de invitación abiertos, en los dos roles: el que invita
 * espera reclamos, el que entra espera su clave. Sin esto, entrar a un grupo
 * exigiría que las dos personas reinicien la app en el orden correcto.
 */
async function subscribeInvites(): Promise<void> {
  for (const invite of activeInvites()) {
    try {
      const topic = await deriveInviteTopic(invite.token);
      unsubs.push(subscribeTopic(topic, () => { void onInviteNews(invite); }));
    } catch { /* una invitación rota no debe impedir las demás */ }
  }
}

/**
 * Escucha mi propio buzón de contactos: quien escanee mi QR deja su tarjeta
 * ahí, y así el contacto queda en los dos teléfonos sin escanear dos veces.
 */
async function subscribeContacts(): Promise<void> {
  const secret = ensureContactSecret();
  if (!secret) return;

  try {
    const topic = await deriveContactTopic(secret);
    unsubs.push(subscribeTopic(topic, () => { void drainContactsNow(); }));
  } catch { /* sin buzón de contactos la app sigue andando */ }
}

/**
 * Recoge lo que dejaron en mi buzón de contacto: tarjetas y claves de grupo.
 * El cursor se persiste DESPUÉS de aplicarlas.
 */
export async function drainContactsNow(): Promise<number> {
  const secret = ensureContactSecret();
  if (!secret) return 0;

  try {
    const topic = await deriveContactTopic(secret);
    const r = await drainContacts(secret, deviceId(), readCursor(topic));
    writeCursor(topic, r.cursor);

    // T-136 (fix round 1): va ANTES del drainNow/joined-groups de abajo. Ese
    // bloque puede tirar (red, store), y si el aviso quedara después, un
    // throw ahí se comería el único aviso de un conflicto de clave que ya
    // quedó persistido. El cursor y el aviso son lo mínimo que no se puede
    // perder de este drenaje.
    await avisarConflictosDelDrenaje(r);

    // Llegó la clave de un grupo nuevo: hay que bajar su contenido y quedarse
    // escuchando. Sin esto el grupo aparecería recién al reabrir la app.
    if (r.joinedGroups.length > 0) {
      for (const groupId of r.joinedGroups) await drainNow(groupId);
      void startRelay();

      // T-010. Va DESPUÉS de drenar: recién ahí el grupo tiene nombre. Antes
      // el aviso diría "te agregaron a «»", que es peor que no avisar.
      void announce(r.joinedGroups.map(groupId => ({
        kind: 'joined' as const,
        groupId,
        groupName: useGroupStore.getState().getById(groupId)?.name ?? '',
      })).filter(n => n.groupName !== ''));
    }

    return r.added + r.joinedGroups.length + r.conflictedGroups.length;
  } catch {
    return 0; // offline: se reintenta al próximo arranque o aviso
  }
}

/**
 * Le manda la clave del grupo a cada miembro que ya sea un contacto conocido.
 *
 * Es lo que hace que crear un grupo con alguien que escaneaste alcance: le
 * llega solo, sin links ni un segundo escaneo. A los que no son contactos no se
 * les puede mandar nada — para esos queda el link de invitación.
 *
 * **Verifier R3-3 (ronda 3, mitad abierta de D4-bis): pasa por `relayQueue`,
 * con prioridad `alta`.** Antes mandaba todo en un loop directo — la clave
 * del DUEÑO a un miembro nuevo es exactamente el caso que la prioridad alta
 * de la cola existe para cubrir, y un `rate_limited` (cuota compartida con
 * un `reenviarClavesDeGrupo` corriendo al mismo tiempo) se perdía sin
 * reintento. Como el envío ahora es diferido, el número que devuelve es
 * cuántos se ENCOLARON, no cuántos ya salieron — ningún llamador actual
 * espera este valor (todos usan `void announceGroupToContacts(...)`).
 */
export async function announceGroupToContacts(groupId: string): Promise<number> {
  const me = useAuthStore.getState().currentUser;
  const group = useGroupStore.getState().getById(groupId);
  if (!me || !group) return 0;

  /**
   * El estado del grupo se publica ANTES de repartir las claves. Al revés, el
   * que recibe la clave abriría un buzón de grupo todavía vacío, se quedaría
   * sin el grupo y nada volvería a dispararlo.
   *
   * Por eso acá **se drena primero y no se fuerza** (T-089): si la guarda
   * bloqueara esta publicación, el invitado no recibiría el grupo. Es un camino
   * interactivo —el usuario está mirando— así que esperar el drenaje es
   * aceptable. Si el drenaje falla, la publicación no sale **y el reparto de
   * claves tampoco**: es mejor que entregar una clave a un buzón que no se va a
   * llenar.
   */
  await drainNow(groupId);
  if (estaPendienteDeDrenaje(groupId)) return 0;
  await publishNow(groupId);

  marcarAdopciones([groupId]); // conserva prioridad alta si esto se regenera en un próximo arranque
  const owner = me.id; // T-147 (punto 4): mismo criterio que `reenviarClavesDeGrupo`.

  let encolados = 0;
  for (const memberId of group.memberIds) {
    if (memberId === me.id) continue;
    encolados++;
    encolar({
      prioridad: 'alta',
      ejecutar: async () => {
        if ((useAuthStore.getState().currentUser?.id ?? null) !== owner) return 'descartar';
        try {
          const r = await sendGroupKeyResultado(memberId, group, deviceId());
          if (r.ok) return 'hecho';
          // R4-2: mismo criterio — la clave del DUEÑO a un miembro nuevo es
          // justo el caso del PoC del verificador (13 tarjetas + 11 claves
          // en el mismo minuto de cuota): un `rate_limited` acá no puede
          // perderse nunca.
          if (r.reason === 'rate_limited') return 'reintentar_cuota';
          return r.reason === 'network' ? 'reintentar' : 'descartar';
        } catch {
          return 'reintentar';
        }
      },
    });
  }

  return encolados;
}

async function onInviteNews(invite: GroupInvite): Promise<void> {
  const adoptados = await processInvite(invite, deviceId()).catch(() => [] as string[]);
  if (adoptados.length === 0) return;

  // Adoptamos una clave nueva: hay que suscribirse al grupo. La recursión está
  // acotada — el ingreso ya se marcó como resuelto, así que el `startRelay` de
  // adentro no vuelve a adoptar nada.
  await startRelay();
}

export function stopRelay(): void {
  for (const off of unsubs) { try { off(); } catch { /* ya cortado */ } }
  unsubs = [];
  stopPolling();
  // Sin esto, un drenaje agendado por un aviso justo antes de cortar (cambio
  // de cuenta, logout) dispararía después de que las suscripciones ya se
  // cerraron — contra un grupo que puede ya no ser el activo.
  cancelPendingDrains();
}

/**
 * Cambio de cuenta / logout. Se llama ANTES de `rehydrateForActiveUser`
 * (`src/store/session.ts`), y hace lo que el PO pidió como cinturón de
 * seguridad — sea cual sea el TIPO de sesión que tenía el buzón (T-147-b:
 * de identidad para una cuenta, anónima para un invitado), ningún trabajo
 * diferido de la cuenta anterior puede seguir saliendo con la sesión que
 * quedó abierta:
 *
 *  1. Corta el motor (canales, polling, drenajes agendados).
 *  2. Cancela los envíos de grupo debounced (`schedulePublish`) que todavía
 *     no dispararon.
 *  3. Vacía `relayQueue` (tarjetas y claves en cola, incluidas las que
 *     esperan su ventana de cuota) — nada de lo encolado por la cuenta
 *     anterior llega a ejecutarse.
 *  4. Cierra la sesión del buzón (la que hubiera) y fuerza el borrado de su
 *     storage: la próxima `ensureRelaySession()` (la dispara `startRelay`,
 *     llamado por `rehydrateForActiveUser` después de esto) decide desde
 *     cero según el usuario NUEVO — filas 7 (invitado → cuenta) y 8 (cambio
 *     de cuenta A→B) de la tabla de T-147-b.
 *
 * Los pasos 1-3 son síncronos a propósito — nada quedan "en vuelo" cuando
 * esta función retorna. El paso 4 es async, pero pasa por la MISMA cola que
 * `ensureRelaySession()` (ver `relaySession.ts`): como `rehydrateForActiveUser`
 * llama a `startRelay()` (que termina llamando a `ensureRelaySession()`) de
 * inmediato después de esto, el orden de ENCOLADO ya garantiza que el
 * reinicio de sesión corre antes que esa lectura, sin necesidad de esperarlo
 * acá.
 */
export function reiniciarSyncPorCambioDeCuenta(): void {
  stopRelay();
  cancelPendingPublishes();
  vaciarCola();
  void reabrirSesionAnonima();
}
