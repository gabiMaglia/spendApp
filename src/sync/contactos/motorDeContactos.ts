import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { withTimeout } from '@/src/utils/withTimeout';
import { announce } from '@/src/services/notifications';
import {
  sendGroupKeyResultado, announceCardResultado, listPeers, myContactCard, cardFingerprint,
  cardYaEnviada, marcarCardEnviada, ensureContactSecret, deriveContactTopic, drainContacts,
} from './contactChannel';
import { avisarConflictosDelDrenaje } from '@/src/sync/invitaciones/keyConflictNotice';
import { encolar } from '@/src/sync/motor/relayQueue';
import { estaPendienteDeDrenaje } from '@/src/sync/motor/pendingDrain';
import { readCursor, writeCursor, deviceId } from '@/src/sync/motor/cursor';
import { syncableGroupIds, publishNow } from '@/src/sync/motor/agendaDePublicacion';
import { drainNow } from '@/src/sync/motor/agendaDeDrenaje';

/**
 * Contactos (T-189): tarjeta propia, reenvío de claves de grupo y drenaje del
 * buzón de contactos. `drainNow`/`publishNow` se importan directo de
 * `./drain.ts`/`./publish.ts` (dirección fija: fachada → invitaciones →
 * contactos → drain → publish → poll/cursor). Lo único "hacia arriba"
 * (`startRelay`) llega como PARÁMETRO de la llamada, como `startPolling(releer)`.
 */

/** T-138-bis: ver `anunciarMiTarjeta`. */
const ANUNCIO_TIMEOUT_MS = 8_000;
const storage = createSecureStorage('groupkeys');

/**
 * Reparte la tarjeta propia a TODOS los contactos conocidos.
 *
 * Corre en DOS momentos: al cambiarse el nombre (para que llegue en el acto)
 * y en CADA arranque, porque lo primero es un disparo único — si ese envío
 * falló, el nombre nuevo no se reintentaba NUNCA. Mismo modo de falla
 * silenciosa que ya mordió con las claves de grupo.
 *
 * Pasa por `relayQueue` (prioridad `normal`) para no competir sin ritmo con
 * las claves de grupo por la misma cuota del uid (T-147, ver `relayQueue.ts`).
 */
export async function anunciarMiTarjeta(): Promise<void> {
  const card = myContactCard();
  if (!card) return;
  const huella = cardFingerprint(card);
  // T-147 (punto 4): el DUEÑO se fija ACÁ, al encolar. Si la cuenta activa
  // cambia antes de que el trabajo corra, se descarta sin mandar nada.
  const owner = useAuthStore.getState().currentUser?.id ?? null;

  for (const [userId, peer] of Object.entries(listPeers())) {
    if (!peer.secret) continue;
    // Ya tiene esta versión: no se le manda nada — el costo converge a CERO
    // cuando no cambió nada.
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

/** Cooldown contra la cuota (20 sobres/min, 011a) — UN reenvío real cada
 *  `REENVIO_CLAVES_COOLDOWN_MS`, sea cual sea la cantidad de reinicios
 *  (T-147: no alcanza solo contra la ráfaga de un único arranque, medido
 *  5×8 → 35 sobres); cada sobre pasa por `relayQueue`. */
const REENVIO_CLAVES_COOLDOWN_MS = 5 * 60_000;
let ultimoReenvioClaves = 0;

/** La prioridad `alta` sobrevive a matar la app (T-147) — se persiste qué
 *  grupos siguen "recién adoptados" (TTL generoso) junto a los cursores,
 *  para que un arranque en frío no los degrade a `normal`. */
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

/**
 * Reenvía la clave de cada grupo propio a los contactos que son miembros.
 * Reintento del reparto: si al crear el grupo todavía no conocíamos las
 * públicas del otro, la entrega no salió y nada volvía a dispararla.
 * Adoptar una clave que ya se tiene es un no-op, así que repetirlo es barato.
 */
export async function reenviarClavesDeGrupo(adoptados: string[] = []): Promise<void> {
  const me = useAuthStore.getState().currentUser;
  if (!me) return;
  // T-147 (punto 4): mismo criterio que `anunciarMiTarjeta` — el dueño se
  // fija al encolar, y se revalida al ejecutar.
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
            // `rate_limited` NO es un fallo permanente — cuenta contra un
            // tope de horas, no de ~32s (ver `relayQueue.ts`).
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
 * Le manda la clave del grupo a cada miembro que ya sea contacto conocido —
 * a los que no son contactos les queda el link de invitación. Pasa por
 * `relayQueue` con prioridad `alta`; devuelve cuántos se ENCOLARON (el envío
 * es diferido).
 */
export async function announceGroupToContacts(groupId: string): Promise<number> {
  const me = useAuthStore.getState().currentUser;
  const group = useGroupStore.getState().getById(groupId);
  if (!me || !group) return 0;

  // El estado se publica ANTES de repartir claves (si no, el invitado abre un
  // buzón vacío). T-089: se drena primero y no se fuerza — si la guarda lo
  // bloquea, ni la publicación ni el reparto de claves salen.
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
          // R4-2: `rate_limited` no es un fallo permanente — no puede perderse.
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

/**
 * Recoge lo que dejaron en mi buzón de contacto: tarjetas y claves de grupo.
 * El cursor se persiste DESPUÉS de aplicarlas. `startRelay` llega por
 * PARÁMETRO (lo pasa quien llama, ver comentario del tope del archivo) —
 * nunca como estado de módulo.
 */
export async function drainContactsNow(startRelay: () => Promise<void>): Promise<number> {
  const secret = ensureContactSecret();
  if (!secret) return 0;

  try {
    const topic = await deriveContactTopic(secret);
    const r = await drainContacts(secret, deviceId(), readCursor(topic));
    writeCursor(topic, r.cursor);

    // T-136: va ANTES del drainNow/joined-groups — ese bloque puede tirar y
    // se comería el aviso de un conflicto de clave ya persistido.
    await avisarConflictosDelDrenaje(r);

    // Llegó la clave de un grupo nuevo: bajar su contenido y quedarse escuchando.
    if (r.joinedGroups.length > 0) {
      for (const groupId of r.joinedGroups) await drainNow(groupId);
      void startRelay();

      // T-010: va DESPUÉS de drenar — recién ahí el grupo tiene nombre.
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
