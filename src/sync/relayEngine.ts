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
export async function startRelay(): Promise<void> {
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
  await drainAll(); // al arrancar, lo encolado mientras estuvimos afuera

  // Un grupo recién adoptado no estaba en la cola de arriba cuando se drenó,
  // así que se drena explícitamente: es justo el caso en el que el usuario está
  // mirando la pantalla esperando ver el grupo aparecer.
  for (const groupId of adoptados) await drainNow(groupId);
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
}
