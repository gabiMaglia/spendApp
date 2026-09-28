import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { withTimeout } from '@/src/utils/withTimeout';
import {
  sendGroupKeyResultado, announceCardResultado, listPeers, myContactCard, cardFingerprint,
  cardYaEnviada, marcarCardEnviada,
} from '../contactChannel';
import { encolar } from '../relayQueue';
import { deviceId } from './cursor';
import { syncableGroupIds } from './publish';

/**
 * Contactos (T-189: extraído de `relayEngine.ts`): reparto de tarjeta propia
 * y reenvío de claves de grupo a contactos conocidos.
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
 * Verifier R4-2: pasa por `relayQueue` (prioridad `normal`) para no competir
 * sin ritmo con las claves de grupo por la misma cuota del uid.
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

/**
 * **Verifier D4: cooldown contra la cuota (20 sobres/min, 011a).** Corre en
 * cada `startRelay()`; sin freno, un grupo de M miembros manda M-1 sobres por
 * reinicio, y varios reinicios seguidos en un login normal pueden acercarse
 * o pasar la cuota sin que el usuario haya tocado nada. El cooldown lo acota
 * a UN reenvío real cada `REENVIO_CLAVES_COOLDOWN_MS`.
 *
 * **Ronda 2: el cooldown solo no alcanza** contra la ráfaga de UN SOLO
 * arranque (medido: 5×8 → 35 sobres, contra 20/min de cuota). Cada sobre pasa
 * por `relayQueue`: los grupos recién ADOPTADOS van con prioridad `alta`, el
 * resto es reenvío de rutina (`normal`).
 */
const REENVIO_CLAVES_COOLDOWN_MS = 5 * 60_000;
let ultimoReenvioClaves = 0;

/**
 * **Verifier R3-3(c): la prioridad `alta` sobrevive a matar la app.**
 * `relayQueue` vive sólo en memoria — se persiste qué grupos siguen "recién
 * adoptados" (TTL generoso) en el mismo bucket cifrado que ya guarda los
 * cursores, para que un arranque en frío no los degrade a prioridad `normal`.
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
export function marcarAdopciones(ids: string[]): void {
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
            // R4-2: `rate_limited` NO es un fallo permanente — cuenta contra
            // un tope de horas, no de ~32s (ver `relayQueue.ts`).
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
