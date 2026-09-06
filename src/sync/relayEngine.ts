import { AppState } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { snapshot, noticesFor, type Snapshot } from '@/src/services/syncNotices';
import { announce } from '@/src/services/notifications';
import { useAuthStore } from '@/src/store/authStore';
import { deriveTopic } from './envelopeCrypto';
import { subscribeTopic, isRelayConfigured } from './relay';
import { publishToGroup, drainGroup, type PublishResult } from './relaySync';
import { recordPublish } from './publishHealth';
import { noticeDeCaida } from './syncDownNotices';
import { noticeDeReloj } from './clockNotice';
import { resolvePendingDeletions } from '@/src/services/resolveDeletions';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { fromHex } from './envelopeCrypto';
import { deriveInviteTopic, type GroupInvite } from './groupInvite';
import { activeInvites, processInvite, processAllInvites } from './inviteEngine';
import { verifyMyKeyRegistered } from './deviceKeys';
import {
  ensureContactSecret, deriveContactTopic, drainContacts, sendGroupKey,
  announceContact, listPeers, myContactCard, cardFingerprint,
  cardYaEnviada, marcarCardEnviada,
} from './contactChannel';

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
const CURSOR_PREFIX = 'cursor::';

/**
 * Cada cuánto se relee todo mientras la app está en primer plano.
 *
 * El aviso realtime es SÓLO un aviso: puede perderse (websocket caído, app en
 * background, red que cambió) y no hay forma de saber que se perdió. Toda la
 * arquitectura dice que la verdad se lee por cursor... pero hasta acá la única
 * lectura pasaba al arrancar la app. Resultado: un aviso perdido significaba un
 * gasto que NUNCA aparecía hasta reiniciar. Esto es lo que hace cierto el
 * invariante que ya estaba escrito.
 *
 * 20s es barato —una query indexada por grupo— y es el orden de magnitud que
 * la gente tolera esperando ver un gasto que acaba de cargar el otro.
 */
export const POLL_INTERVAL_MS = 20_000;

/** Ventana de agrupación: suficiente para juntar una edición, imperceptible. */
export const PUBLISH_DEBOUNCE_MS = 1_500;

export function readCursor(topic: string): number {
  const raw = storage.getString(CURSOR_PREFIX + topic);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function writeCursor(topic: string, seq: number): void {
  storage.set(CURSOR_PREFIX + topic, String(seq));
}

/**
 * Olvida el cursor de un topic (T-074). Se llama al purgar el buzón de una
 * cuenta que se borra: sin esto queda un puntero a un grupo cuya clave ya no
 * está. No es un defecto —una relectura desde 0 es idempotente— pero es basura.
 */
export function olvidarCursor(topic: string): void {
  storage.delete(CURSOR_PREFIX + topic);
}

/** Id estable de este dispositivo, para no reprocesar lo propio. */
export function deviceId(): string {
  const existing = storage.getString('device_id');
  if (existing) return existing;
  const id = `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  storage.set('device_id', id);
  return id;
}

/** Grupos vivos de los que tenemos clave: los únicos sincronizables. */
export function syncableGroupIds(): string[] {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return [];

  const conClave = new Set(useGroupKeyStore.getState().keys.map(k => k.groupId));
  return useGroupStore.getState().groups
    .filter(g => !g.isDeleted && g.memberIds.includes(userId) && conClave.has(g.id))
    .map(g => g.id);
}

// --- publicación con debounce ------------------------------------------------

const pendientes = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Publica el estado del grupo, agrupando ráfagas de cambios.
 * Llamarla muchas veces seguidas produce UN solo envío.
 */
export function schedulePublish(groupId: string, delay = PUBLISH_DEBOUNCE_MS): void {
  if (!isRelayConfigured()) return;

  const anterior = pendientes.get(groupId);
  if (anterior) clearTimeout(anterior);

  pendientes.set(groupId, setTimeout(() => {
    pendientes.delete(groupId);
    void publishNow(groupId);
  }, delay));
}

export async function publishNow(groupId: string): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return;

  // Un fallo de red no puede romper la app: se reintentará en el próximo cambio
  // o cuando el usuario vuelva a abrirla. Pero SE ANOTA: tragárselo sin dejar
  // rastro es lo que produjo dos veces "no me llega nada" sin nada que mirar.
  let result: PublishResult;
  try {
    result = await publishToGroup(groupId, userId, deviceId());
  } catch (e) {
    result = { ok: false, reason: 'network', detail: String(e) };
  }

  recordPublish(groupId, result);
  void avisarSiDejoDeSincronizar(groupId, result);
  void avisarSiElRelojEstaMal();
}

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

/** Sólo para tests: cancela los envíos pendientes. */
export function cancelPendingPublishes(): void {
  for (const t of pendientes.values()) clearTimeout(t);
  pendientes.clear();
}

// --- drenaje -----------------------------------------------------------------

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
  const antes = snapshot(useExpenseStore.getState().expenses, syncedNow(), usePaymentStore.getState().payments);

  try {
    const topic = await deriveTopic(fromHex(record.key), record.epoch);
    const r = await drainGroup(groupId, userId, deviceId(), readCursor(topic));
    if (!r.ok) return 0;

    writeCursor(topic, r.cursor);

    // Los votos de borrado viajan como cualquier campo: lo que acaba de llegar
    // puede completar una ronda que hasta recién figuraba pendiente.
    if (r.applied > 0) {
      resolvePendingDeletions();
      applyApprovedLeaves();
    }

    // T-010. Va DESPUÉS de resolver borrados: una ronda que acaba de vencer ya
    // no es un pedido pendiente y no tiene por qué avisarse.
    if (r.applied > 0) void avisarDeLoNuevo(antes, userId);

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

/** Drena todos los grupos sincronizables. Se llama al abrir la app. */
export async function drainAll(): Promise<number> {
  let total = 0;
  for (const groupId of syncableGroupIds()) total += await drainNow(groupId);
  return total;
}

// --- suscripción -------------------------------------------------------------

let unsubs: Array<() => void> = [];

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

export function startRelay(): Promise<void> {
  if (arrancando) return arrancando;
  arrancando = doStartRelay().finally(() => { arrancando = null; });
  return arrancando;
}

async function doStartRelay(): Promise<void> {
  stopRelay();
  if (!isRelayConfigured()) return;

  // Las invitaciones se resuelven PRIMERO: una que se complete acá adopta la
  // clave del grupo, y recién con esa clave el grupo entra en `syncableGroupIds`
  // y se puede suscribir abajo. Al revés habría que esperar al próximo arranque.
  const adoptados = await processAllInvites(deviceId()).catch(() => [] as string[]);

  for (const groupId of syncableGroupIds()) {
    const record = useGroupKeyStore.getState().getKey(groupId);
    if (!record) continue;

    try {
      const topic = await deriveTopic(fromHex(record.key), record.epoch);
      unsubs.push(subscribeTopic(topic, () => { void drainNow(groupId); }));
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

  await reenviarClavesDeGrupo();
  startPolling();
}

// --- relectura periódica ------------------------------------------------------

let poll: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

/**
 * Relee todo cada `POLL_INTERVAL_MS` y también al volver del background.
 *
 * Lo segundo importa tanto como lo primero: en background el websocket se cae y
 * los avisos de ese rato no llegan nunca. Volver a la app tiene que ponerte al
 * día, que es exactamente cuando el usuario está mirando.
 */
function startPolling(): void {
  stopPolling();

  poll = setInterval(() => { void releerTodo(); }, POLL_INTERVAL_MS);

  appStateSub = AppState.addEventListener('change', estado => {
    if (estado === 'active') void releerTodo();
  });
}

function stopPolling(): void {
  if (poll) { clearInterval(poll); poll = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
}

async function releerTodo(): Promise<void> {
  try {
    await drainContactsNow();
    await drainAll();
  } catch { /* offline: se reintenta en la próxima vuelta */ }
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
export async function anunciarMiTarjeta(): Promise<void> {
  const card = myContactCard();
  if (!card) return;
  const huella = cardFingerprint(card);

  for (const [userId, peer] of Object.entries(listPeers())) {
    if (!peer.secret) continue;
    // Ya tiene esta versión: no se le manda nada. Es lo que hace que el costo
    // converja a CERO cuando no cambió nada, en vez de un sobre por contacto
    // por arranque para siempre.
    if (cardYaEnviada(userId, huella)) continue;

    // Se marca sólo si salió bien, así un fallo de red se reintenta solo.
    // Un contacto que falla no puede frenar a los demás.
    try {
      if (await announceContact(peer.secret, deviceId())) marcarCardEnviada(userId, huella);
    } catch { /* sigue con el resto */ }
  }
}

/**
 * Reenvía la clave de cada grupo propio a los contactos que son miembros.
 *
 * Es el reintento del reparto: si cuando se creó el grupo todavía no
 * conocíamos las públicas del otro, la entrega no salió y NADA volvía a
 * dispararla. Adoptar una clave que ya se tiene es un no-op, así que repetirlo
 * no cuesta nada más que unos pocos bytes por arranque.
 */
async function reenviarClavesDeGrupo(): Promise<void> {
  const me = useAuthStore.getState().currentUser;
  if (!me) return;

  for (const groupId of syncableGroupIds()) {
    const group = useGroupStore.getState().getById(groupId);
    if (!group) continue;

    for (const memberId of group.memberIds) {
      if (memberId === me.id) continue;
      try { await sendGroupKey(memberId, group, deviceId()); } catch { /* sigue */ }
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

    return r.added + r.joinedGroups.length;
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
 */
export async function announceGroupToContacts(groupId: string): Promise<number> {
  const me = useAuthStore.getState().currentUser;
  const group = useGroupStore.getState().getById(groupId);
  if (!me || !group) return 0;

  // El estado del grupo se publica ANTES de repartir las claves. Al revés, el
  // que recibe la clave abriría un buzón de grupo todavía vacío, se quedaría
  // sin el grupo y nada volvería a dispararlo.
  await publishNow(groupId);

  let enviados = 0;
  for (const memberId of group.memberIds) {
    if (memberId === me.id) continue;
    try {
      if (await sendGroupKey(memberId, group, deviceId())) enviados++;
    } catch { /* un contacto que falla no debe impedir los demás */ }
  }

  return enviados;
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
}
