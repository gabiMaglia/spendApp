import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
import { announce } from '@/src/services/notifications';
import { isRelayConfigured } from '@/src/sync/adaptadores/supabase/relay';
import { publishToGroup, type PublishResult } from './relaySync';
import { recordPublish, publishFailures } from './publishHealth';
import { noticeDeCaida } from '@/src/sync/avisos/syncDownNotices';
import { noticeDeReloj } from '@/src/sync/avisos/clockNotice';
import { estaPendienteDeDrenaje } from './pendingDrain';
import { deviceId } from './cursor';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import { publicadoMasViejoEn } from '@/src/sync/nucleo/sliceLedger';
import { RENEWAL_WINDOW_MS } from '@/src/sync/nucleo/limites';
import * as adaptador from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import {
  marcarPublicacionPendiente, limpiarPublicacionPendiente, versionDePublicacion,
  gruposConPublicacionPendiente,
} from './publicacionPendiente';

/**
 * Publicación con debounce (T-189: extraído de `relayEngine.ts`).
 *
 * Publicar va con debounce: cargar un gasto dispara varios cambios de store
 * seguidos; sin agrupar, se manda un sobre por cada uno y se quema la cuota
 * del relay con estados intermedios que nadie va a leer.
 */

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

  // T-252: la marca se pone ANTES del debounce. Si la app muere dentro de la
  // ventana, el próximo arranque ve la marca y publica.
  marcarPublicacionPendiente(groupId);

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
export async function publishNow(
  groupId: string, opts: { forzar?: boolean } = {},
): Promise<PublishResult> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return { ok: false, reason: 'not_configured' };

  // T-252: «hay cambios sin publicar» desde acá hasta un ok. Cubre también a los
  // llamadores directos que no pasan por `schedulePublish`.
  marcarPublicacionPendiente(groupId);
  const version = versionDePublicacion(groupId);

  /**
   * **La guarda de T-089, y va acá y no en `schedulePublish`.** `publishNow` es
   * el embudo real: `schedulePublish` es sólo su debounce, y hay dos llamadores
   * directos más (`announceGroupToContacts` y el aviso de T-074) que se
   * saltearían una guarda puesta más arriba.
   *
   * T-252: la marca de publicación queda puesta; cuando el drenaje termina,
   * `drainNow` publica (`agendaDeDrenaje`).
   */
  if (!opts.forzar && estaPendienteDeDrenaje(groupId)) {
    const r: PublishResult = { ok: false, reason: 'pending_drain' };
    recordPublish(groupId, r);
    return r;
  }

  // Un fallo de red no puede romper la app. NO se pierde: la marca persistente
  // de T-252 hace que el arranque, el poll y la vuelta a primer plano lo
  // reintenten (`reintentarPublicacionesPendientes`). Además SE ANOTA: tragárselo
  // sin rastro produjo dos veces «no me llega nada» sin nada que mirar.
  enVuelo.add(groupId);
  let result: PublishResult;
  try {
    result = await publishToGroup(groupId, userId, deviceId());
  } catch (e) {
    result = { ok: false, reason: 'network', detail: String(e) };
  } finally {
    enVuelo.delete(groupId);
  }

  if (result.ok) {
    // Sólo baja si nadie marcó de nuevo mientras volaba (lo nuevo no iba en este sobre).
    limpiarPublicacionPendiente(groupId, version);
    backoff.delete(groupId);
  } else {
    anotarFallo(groupId, result);
  }

  recordPublish(groupId, result);
  void avisarSiDejoDeSincronizar(groupId, result);
  void avisarSiElRelojEstaMal();
  return result;
}

// ── reintento (T-252) ───────────────────────────────────────────────────────

const enVuelo = new Set<string>();
const backoff = new Map<string, { fallos: number; hasta: number }>();

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_TOPE_MS = 10 * 60_000;

/** Fallos que esperar no arregla: se reintentan, pero espaciados al tope. */
function esPermanente(reason: string): boolean {
  return reason === 'too_large' || reason === 'no_key' || reason === 'not_configured';
}

/**
 * `relaySend` clasifica TODO error del servidor como `network` (también RLS o
 * la prenda). Hasta separarlos de verdad, se los reconoce por el texto para no
 * martillar: un rechazo de permisos no se arregla reintentando cada 30 s.
 */
function rechazoDelServidor(detail?: string): boolean {
  return !!detail && /row-level security|permission denied|42501/i.test(detail);
}

function anotarFallo(groupId: string, r: Extract<PublishResult, { ok: false }>): void {
  if (r.reason === 'pending_drain') return; // no es un fallo: se destraba solo
  const fallos = (backoff.get(groupId)?.fallos ?? 0) + 1;
  const espera = esPermanente(r.reason) || rechazoDelServidor(r.detail)
    ? BACKOFF_TOPE_MS
    : Math.min(BACKOFF_BASE_MS * 2 ** (fallos - 1), BACKOFF_TOPE_MS);
  backoff.set(groupId, { fallos, hasta: Date.now() + espera });
}

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

/** Sólo para tests: cancela los envíos pendientes. */
export function cancelPendingPublishes(): void {
  for (const t of pendientes.values()) clearTimeout(t);
  pendientes.clear();
}

/**
 * Publica los grupos con cambios locales sin publicar (T-252). Lo llaman el
 * arranque de la cadena de sync, cada vuelta del poll y la vuelta a primer plano
 * — SIEMPRE después de drenar (guarda T-089).
 *
 * Subsume al viejo reintento de `rate_limited` (verifier D4): ese fallo también
 * deja la marca puesta. Como máximo UN intento por grupo por vuelta, y tras un
 * fallo se espera (backoff exponencial 30 s → 10 min; 10 min fijos para los que
 * esperar no arregla) para no martillar al servidor con un error permanente.
 *
 * Los grupos con envío en debounce o en vuelo se saltean: ya van a publicar.
 */
export async function reintentarPublicacionesPendientes(): Promise<void> {
  const ids = new Set(gruposConPublicacionPendiente());
  for (const f of publishFailures()) if (f.reason === 'rate_limited') ids.add(f.groupId);

  for (const groupId of ids) {
    if (pendientes.has(groupId) || enVuelo.has(groupId)) continue;
    if (Date.now() < (backoff.get(groupId)?.hasta ?? 0)) continue;
    // Un grupo que ya no existe en este teléfono no tiene nada que publicar.
    if (!useGroupStore.getState().groups.some(g => g.id === groupId)) {
      limpiarPublicacionPendiente(groupId);
      continue;
    }
    if (!useGroupKeyStore.getState().getKey(groupId)) continue;
    await publishNow(groupId);
  }
}

// ── renovación contra el TTL (T-267) ────────────────────────────────────────

/** Entre dos intentos de renovar el mismo grupo: no es urgente, no se martilla. */
const ENFRIAMIENTO_RENOVACION_MS = 60 * 60_000;
const ultimaRenovacion = new Map<string, number>();

/**
 * El buzón borra todo a los 30 días (`001_mailbox.sql`) y `publicarPorCubos`
 * sólo renueva dentro de una publicación, que sólo ocurre por un cambio local:
 * un grupo quieto vencía aunque todos abrieran la app. Acá, en el ciclo de
 * sync (arranque y poll, DESPUÉS de drenar: guarda T-089), se mira el cubo
 * propio más viejo del ledger; si pasó `RENEWAL_WINDOW_MS` (20 d, margen de
 * 10 d), se publica — `publicarPorCubos` reenvía justo los cubos vencidos y el
 * manifiesto. Sin tormenta: cada aparato renueva SÓLO sus sobres (la `ckey` es
 * por aparato) y su reloj es el de su propio ledger, así que los miembros no
 * se sincronizan entre sí; tras renovar, el ledger se actualiza y no vuelve a
 * disparar hasta dentro de otros 20 días. No cambia el formato del sobre.
 */
export async function renovarGruposVencidos(): Promise<void> {
  const ahora = Date.now();
  for (const groupId of syncableGroupIds()) {
    if (pendientes.has(groupId) || enVuelo.has(groupId)) continue;
    if (ahora < (backoff.get(groupId)?.hasta ?? 0)) continue;
    if (ahora - (ultimaRenovacion.get(groupId) ?? -Infinity) < ENFRIAMIENTO_RENOVACION_MS) continue;

    const key = groupKeyBytes(groupId);
    const record = useGroupKeyStore.getState().getKey(groupId);
    if (!key || !record) continue;
    const topic = await deriveTopic(key, record.epoch);
    const masViejo = publicadoMasViejoEn(adaptador.almacen, topic, deviceId());
    if (masViejo === null || ahora - masViejo <= RENEWAL_WINDOW_MS) continue;

    ultimaRenovacion.set(groupId, ahora);
    await publishNow(groupId);
  }
}

/** Sólo para tests. */
export function __resetRenovaciones(): void {
  ultimaRenovacion.clear();
}

/** Sólo para tests. */
export function __resetReintentos(): void {
  backoff.clear();
  enVuelo.clear();
}
