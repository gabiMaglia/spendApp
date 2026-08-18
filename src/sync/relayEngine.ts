import { AppState } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useAuthStore } from '@/src/store/authStore';
import { deriveTopic } from './envelopeCrypto';
import { subscribeTopic, isRelayConfigured } from './relay';
import { publishToGroup, drainGroup } from './relaySync';
import { fromHex } from './envelopeCrypto';
import { deriveInviteTopic, type GroupInvite } from './groupInvite';
import { activeInvites, processInvite, processAllInvites } from './inviteEngine';
import {
  ensureContactSecret, deriveContactTopic, drainContacts, sendGroupKey,
  announceContact, peersIncompletos,
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
  // o cuando el usuario vuelva a abrirla.
  try { await publishToGroup(groupId, userId, deviceId()); } catch { /* offline */ }
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

  try {
    const topic = await deriveTopic(fromHex(record.key), record.epoch);
    const r = await drainGroup(groupId, userId, deviceId(), readCursor(topic));
    if (!r.ok) return 0;

    writeCursor(topic, r.cursor);
    return r.applied;
  } catch {
    return 0; // offline: se reintenta al próximo arranque o aviso
  }
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
  await completarContactos();
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
 * Le manda la tarjeta propia a los contactos de los que todavía no tenemos sus
 * claves públicas.
 *
 * Repara los contactos agregados con una versión anterior del código, que no
 * las incluía. Sin ellas no se les puede entregar la clave de ningún grupo, y
 * el síntoma es el peor de todos: el grupo simplemente no les llega, sin error
 * ni aviso. Al recibir la tarjeta, el otro lado responde con la suya y los dos
 * quedan completos — sin volver a escanear nada.
 */
async function completarContactos(): Promise<void> {
  for (const secreto of peersIncompletos()) {
    try { await announceContact(secreto, deviceId()); } catch { /* se reintenta */ }
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
