import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { esYo } from '@/src/store/identityAlias';
import { isRelayConfigured } from '../relay';
import { publishToGroup, type PublishResult } from '../relaySync';
import { recordPublish, publishFailures } from '../publishHealth';
import { estaPendienteDeDrenaje } from '../pendingDrain';
import { deviceId } from './cursor';

/**
 * Publicación con debounce (T-189: extraído de `relayEngine.ts`).
 *
 * Publicar va con debounce: cargar un gasto dispara varios cambios de store
 * seguidos; sin agrupar, se manda un sobre por cada uno y se quema la cuota
 * del relay con estados intermedios que nadie va a leer.
 */

/**
 * `avisarSiDejoDeSincronizar`/`avisarSiElRelojEstaMal` (en la fachada) llaman
 * a la función de aviso del sistema (bandeja + notificación), y
 * `inventarioDeAvisos.test.ts` exige
 * que **sólo** `services/notifications.ts` y la fachada (`relayEngine.ts`)
 * contengan esa llamada — es el inventario de quién puede escribir en la
 * bandeja. Este módulo no la hace directamente: notifica por este hook,
 * inyectado UNA vez desde la fachada (mismo patrón que `startPolling(releer)`
 * en `./poll.ts`, para no importar el dominio "hacia arriba").
 */
export type NotificadorDePublish = (groupId: string, result: PublishResult) => void;
let notificar: NotificadorDePublish = () => {};

/** Sólo la fachada llama a esto, una vez, al cargar el módulo. */
export function setNotificadorDePublish(fn: NotificadorDePublish): void {
  notificar = fn;
}

/** Ventana de agrupación: suficiente para juntar una edición, imperceptible. */
export const PUBLISH_DEBOUNCE_MS = 1_500;

/**
 * Grupos vivos de los que tenemos clave: los únicos sincronizables.
 *
 * La membresía se pregunta con `esYo()` y no contra el id activo (T-048 · D-4):
 * un grupo heredado de una cuenta absorbida nombra a su dueño con la identidad
 * VIEJA en `memberIds`, y ese roster no se reescribe nunca (D-6). Sin esto, esos
 * grupos **dejaban de sincronizar aunque tuviéramos su clave** — el usuario los
 * veía quietos, sin un solo mensaje de error.
 *
 * Lo que se PUBLICA sigue saliendo con los ids tal cual están guardados: acá
 * sólo se decide a qué buzones suscribirse.
 */
export function syncableGroupIds(): string[] {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return [];

  const conClave = new Set(useGroupKeyStore.getState().keys.map(k => k.groupId));
  return useGroupStore.getState().groups
    .filter(g => !g.isDeleted && g.memberIds.some(esYo) && conClave.has(g.id))
    .map(g => g.id);
}

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

/**
 * `forzar` existe para UN caso y hay que decir cuál: el aviso de cuenta borrada
 * de T-074 (`src/services/deleteAccount.ts`). Bloquearlo dejaría el nombre y la
 * foto de la persona en el teléfono de todos **para siempre**, que es peor que
 * el riesgo que la guarda evita. **Riesgo aceptado y escrito**: ese envío puede
 * republicar estado viejo de un grupo que este teléfono nunca drenó.
 */
export async function publishNow(groupId: string, opts: { forzar?: boolean } = {}): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return;

  /**
   * **La guarda de T-089, y va acá y no en `schedulePublish`.** `publishNow` es
   * el embudo real: `schedulePublish` es sólo su debounce, y hay dos llamadores
   * directos más (`announceGroupToContacts` y el aviso de T-074) que se
   * saltearían una guarda puesta más arriba.
   */
  if (!opts.forzar && estaPendienteDeDrenaje(groupId)) {
    recordPublish(groupId, { ok: false, reason: 'pending_drain' });
    return;
  }

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
  notificar(groupId, result);
}

/** Sólo para tests: cancela los envíos pendientes. */
export function cancelPendingPublishes(): void {
  for (const t of pendientes.values()) clearTimeout(t);
  pendientes.clear();
}

/**
 * Verifier D4: `rate_limited` es no bloqueante a propósito (H6 — no se
 * muestra nada, igual que `network`), pero "no bloqueante" no puede
 * significar "se pierde". Sin esto, una rebanada rechazada por la cuota se
 * queda cortada hasta que el usuario vuelva a tocar ESE grupo (comentario
 * viejo de `publishNow`: "se reintentará en el próximo cambio"), que puede no
 * pasar nunca — los peers se quedan sin ver algo que el dueño cree que ya
 * mandó.
 *
 * El poll ya corre igual; reintentar acá los grupos con un `rate_limited`
 * pendiente no agrega tráfico nuevo mientras todo va bien (la lista sale
 * vacía) y, cuando hay algo pendiente, manda como máximo UN intento por
 * grupo por vuelta — bien por debajo de cualquier cuota.
 */
export async function reintentarPublicacionesConCuota(): Promise<void> {
  for (const f of publishFailures()) {
    if (f.reason !== 'rate_limited') continue;
    await publishNow(f.groupId);
  }
}
