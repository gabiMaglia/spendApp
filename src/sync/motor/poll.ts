import { AppState } from 'react-native';
import { bindAuthRefreshToAppState } from '@/src/sync/sesion/relaySession';

/**
 * Poll adaptativo de respaldo (T-189: extraído de `relayEngine.ts`).
 *
 * El aviso realtime es SÓLO un aviso: puede perderse (websocket caído, app en
 * background, red que cambió) y no hay forma de saber que se perdió. Toda la
 * arquitectura dice que la verdad se lee por cursor... pero hasta acá la única
 * lectura pasaba al arrancar la app. Resultado: un aviso perdido significaba un
 * gasto que NUNCA aparecía hasta reiniciar. Esto es lo que hace cierto el
 * invariante que ya estaba escrito.
 *
 * **T-158a (DEC-04): el intervalo pasó a ser adaptativo.** Con el canal
 * PRIVADO de todos los grupos `SUBSCRIBED`, el aviso realtime ya cubre casi
 * todo y el poll de respaldo puede espaciarse a `POLL_OK_MS` — sigue
 * existiendo por si el aviso se pierde, pero pierde uno de cada tanto es
 * barato. En cuanto algún canal cae (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) o
 * todavía no hay ninguno suscripto (arranque, invitado sin grupos), se vuelve
 * a la cadencia corta de siempre — es la única señal con la que el poll
 * puede saber que el aviso realtime dejó de ser confiable.
 */
export const POLL_OK_MS = 90_000;
export const POLL_CAIDO_MS = 20_000;
// T-206-A (D9): acá vivía `POLL_INTERVAL_MS`, un alias de compat de
// `POLL_CAIDO_MS` sin ningún consumidor de producción — sólo tests, migrados
// a `POLL_CAIDO_MS` directo.

/**
 * Estado del canal PRIVADO de cada topic de GRUPO suscripto (T-158a). Sólo los
 * de grupo entran acá — los de invitación/contacto no participan de esta
 * decisión, y por eso un invitado sin grupos todavía cae en `POLL_CAIDO_MS`
 * (S3): no hay ningún canal de grupo del que decir "está sano".
 */
const estadoCanales = new Map<string, boolean>();

/** Próximo intervalo de poll, recalculado en cada vuelta (DEC-04). */
export function intervaloDePoll(): number {
  if (estadoCanales.size === 0) return POLL_CAIDO_MS;
  for (const ok of estadoCanales.values()) {
    if (!ok) return POLL_CAIDO_MS;
  }
  return POLL_OK_MS;
}

/** Marca el estado (sano/caído) del canal de un topic de grupo. */
export function marcarCanal(topic: string, ok: boolean): void {
  estadoCanales.set(topic, ok);
}

/** Olvida el estado de un único topic (al desuscribirlo). */
export function olvidarCanal(topic: string): void {
  estadoCanales.delete(topic);
}

let poll: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;
let soltarRefresh: (() => void) | null = null;
let releerActual: (() => Promise<void>) | null = null;

/**
 * Verifier ciego (rechazo de perf/ola-b), B1: token de generación de la
 * cadena de poll. `stopPolling`/`startPolling` lo incrementan; cada vuelta de
 * la cadena captura el que estaba vigente al agendarse y sólo reprograma la
 * siguiente si SIGUE siendo el vigente.
 *
 * Hace falta porque `clearTimeout` no alcanza: si un poll YA disparó
 * (la relectura está corriendo, por ejemplo colgada en `ensureRelaySession`)
 * y recién ENTONCES se llama `stopPolling` (o `startPolling`, que empieza
 * llamando a `stopPolling`), `clearTimeout` no tiene nada que cancelar — el
 * timer ya se consumió. Sin este token, el `.finally` de esa vuelta en curso
 * reprogramaba SIEMPRE la siguiente, dejando una cadena viva después del stop
 * o, si hubo un reinicio de por medio, DOS cadenas corriendo en paralelo.
 */
let generacionPoll = 0;

/**
 * Agenda la próxima relectura. Ya no es un `setInterval` de intervalo fijo
 * (T-158a): es una cadena de `setTimeout` que recalcula `intervaloDePoll()`
 * en cada vuelta, así que el espaciado a 90s/20s reacciona al estado de los
 * canales que haya AHORA MISMO, no al que había cuando arrancó el poll.
 */
function programarProximoPoll(generacion: number): void {
  poll = setTimeout(() => {
    void releerActual?.().finally(() => {
      // B1: si `stopPolling`/`startPolling` corrieron mientras la relectura
      // estaba en vuelo, esta cadena ya es vieja — no reprograma.
      if (generacion === generacionPoll) programarProximoPoll(generacion);
    });
  }, intervaloDePoll());
}

/**
 * Arranca la cadena de poll y el enganche de primer plano.
 *
 * `releer` la decide la fachada (`releerTodo`, con toda la cadena de sesión +
 * drenaje + invitaciones + reintentos de cuota) — este módulo sólo sabe CUÁNDO
 * disparar, no QUÉ hacer, para no importar el drenaje "hacia arriba" (la
 * regla del plan: los módulos importan hacia abajo, nunca al revés).
 *
 * Relee también al volver del background: en background el websocket se cae y
 * los avisos de ese rato no llegan nunca. Volver a la app tiene que ponerte al
 * día, que es exactamente cuando el usuario está mirando.
 */
export function startPolling(releer: () => Promise<void>): void {
  stopPolling(); // bumps `generacionPoll`: invalida cualquier cadena vieja en vuelo
  releerActual = releer;

  programarProximoPoll(generacionPoll);

  appStateSub = AppState.addEventListener('change', estado => {
    if (estado === 'active') void releerActual?.();
  });

  // T-147 (D1): el refresco automático del token va atado a primer plano/fondo
  // — en background no tiene sentido reintentar (sin red garantizada) y sólo
  // gasta batería.
  soltarRefresh = bindAuthRefreshToAppState();
}

export function stopPolling(): void {
  generacionPoll++; // B1: invalida la cadena vigente, corra o no ahora mismo
  if (poll) { clearTimeout(poll); poll = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
  if (soltarRefresh) { soltarRefresh(); soltarRefresh = null; }
}
