/**
 * Cola de envíos con ritmo por debajo de la cuota del servidor (T-147 D4,
 * ronda 2 — ruling del orquestador: "la cuota del PO (20 sobres/min) NO
 * cambia. El cliente se autolimita").
 *
 * Todo lo que manda un lote de sobres FUERA de la publicación normal de un
 * grupo —que ya es 1 pedido por grupo por vuelta de poll, ver
 * `relayEngine.reintentarPublicacionesConCuota`— pasa por acá: hoy,
 * `reenviarClavesDeGrupo` y `announceGroupToContacts`. Sin esto, un arranque
 * con varios grupos grandes manda todos los sobres de clave en una ráfaga
 * sin ritmo (medido en la ronda 2 del verifier: 5 grupos × 8 miembros = 35
 * sobres de una, contra una cuota de 20/min).
 *
 * `QUEUE_INTERVAL_MS` separa cada envío REAL, así que la cola nunca puede
 * mandar más rápido que `60_000 / QUEUE_INTERVAL_MS` por minuto — sea cual
 * sea la cantidad de trabajos encolados de golpe. No hace falta contar nada
 * más: el ritmo es la cuota.
 *
 * Dos prioridades: `alta` (claves para miembros de un grupo recién
 * adoptado — se está esperando activamente) va SIEMPRE antes que `normal`
 * (reenvío de rutina, nadie está mirando). Dentro de la misma prioridad,
 * FIFO.
 *
 * Un trabajo que devuelve `'reintentar'` (red, error transitorio genérico)
 * vuelve al FRENTE de su prioridad — nunca se pierde, y no revive antes de
 * la próxima vuelta del ritmo, así que reintentarlo no puede ráfaguear.
 *
 * **Verifier R3-3 (ronda 3): dos agujeros de robustez que el diseño de la
 * ronda 2 no cerraba.**
 *  - **(a) Bloqueo en cabeza.** Un trabajo que SIEMPRE falla (PoC real: una
 *    `wrapPublicKey` inválida de un contacto hace tirar `wrapGroupKey`) volvía
 *    al frente para siempre — 901 reintentos en 1h del PoC, y los trabajos
 *    detrás (sanos) no avanzaban NADA. `MAX_INTENTOS_POR_TRABAJO` lo descarta
 *    con un rastro en el diagnóstico (`errorLog`) y la cola sigue.
 *  - **(b) Cuelgue.** `ejecutar()` no tenía tope de tiempo, contra la regla de
 *    T-138-bis (todo el resto de `relayEngine` sí la sigue): un envío
 *    colgado dejaba `corriendo = true` para siempre y ningún `encolar`
 *    siguiente arrancaba (PoC: 0 hechos en 1h). `EJECUCION_TIMEOUT_MS` lo
 *    corta y lo trata como `'reintentar'` — no cancela la promesa original
 *    (JS no puede), pero deja de esperarla.
 *
 * **Verifier R4-2 (ronda 4): el tope de reintentos descartaba fallos
 * TRANSITORIOS de cuota antes de que la cuota se renovara.** 8 intentos ×
 * `QUEUE_INTERVAL_MS` (4s) ≈ 32s — bastante menos que la ventana real
 * (el minuto de calendario, `011a:229-230`). PoC del verificador: 13
 * tarjetas + 11 claves `alta` en el mismo minuto → la clave #7 se
 * descartaba a los ~56s, justo antes de que la cuota volviera a estar
 * libre. `'reintentar_cuota'` es un resultado APARTE de `'reintentar'`:
 *  - No cuenta para `MAX_INTENTOS_POR_TRABAJO` — un `rate_limited` no es un
 *    fallo permanente, es "todavía no": el trabajo sigue siendo válido para
 *    siempre mientras la sesión lo sea.
 *  - Se reprograma con `REINTENTO_CUOTA_MS` (alineado a la ventana de
 *    cuota, ≥60s) en vez del ritmo normal de la cola — y SIN bloquear a los
 *    demás trabajos: se saca de la cola activa a una lista de espera
 *    (`enEspera`) que la cola sigue revisando en cada vuelta, así que un
 *    trabajo esperando su cuota no le hace fila a los sanos.
 *  - Sólo un backstop de HORAS (`MAX_ANTIGUEDAD_MS`), no de segundos, lo
 *    descarta — para el caso límite de una sesión que dejó de ser válida y
 *    nunca más va a poder mandar nada.
 */

import { recordError } from '@/src/services/errorLog';

export type ResultadoTrabajo = 'hecho' | 'reintentar' | 'reintentar_cuota' | 'descartar';
export type TrabajoCola = { prioridad: 'alta' | 'normal'; ejecutar: () => Promise<ResultadoTrabajo> };

/** 60_000 / 4_000 = 15/min como máximo — por debajo de la cuota real (20/min). */
export const QUEUE_INTERVAL_MS = 4_000;

/** Tope de reintentos por trabajo antes de descartarlo con rastro — SÓLO para
 *  `'reintentar'` (fallos que no son de cuota). Con `QUEUE_INTERVAL_MS` de
 *  espera entre cada uno, agotarlo tarda ~32s. */
export const MAX_INTENTOS_POR_TRABAJO = 8;

/** Espera de un trabajo en `'reintentar_cuota'` antes de volver a intentarse
 *  — alineada a la ventana de cuota real (el minuto de calendario), con
 *  margen. Nunca cuenta contra `MAX_INTENTOS_POR_TRABAJO`. */
export const REINTENTO_CUOTA_MS = 65_000;

/** Backstop final para CUALQUIER trabajo (incluido `'reintentar_cuota'`):
 *  horas, no segundos — sólo para el caso límite de una sesión que dejó de
 *  ser válida para siempre. */
export const MAX_ANTIGUEDAD_MS = 6 * 60 * 60_000;

/** Igual de generoso que el resto del motor (`STARTUP_TIMEOUT_MS`,
 *  `SESSION_TIMEOUT_MS`): un envío real nunca debería tardar esto. */
export const EJECUCION_TIMEOUT_MS = 15_000;

type TrabajoInterno = TrabajoCola & { intentos: number; primerVisto: number };
type EnEspera = { trabajo: TrabajoInterno; listoEn: number };

let alta: TrabajoInterno[] = [];
let normal: TrabajoInterno[] = [];
let enEspera: EnEspera[] = [];
let corriendo = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function descartarConRastro(trabajo: TrabajoInterno, motivo: string): void {
  recordError({
    message: `relayQueue.trabajo_descartado prioridad=${trabajo.prioridad} intentos=${trabajo.intentos} motivo=${motivo}`,
    fatal: false,
    screen: 'sync',
  });
}

/** Mueve a la cola activa los trabajos en espera de cuota cuyo plazo ya
 *  pasó — se llama al principio de cada vuelta. */
function liberarListos(): void {
  if (enEspera.length === 0) return;
  const ahora = Date.now();
  const listos = enEspera.filter(e => e.listoEn <= ahora);
  if (listos.length === 0) return;
  enEspera = enEspera.filter(e => e.listoEn > ahora);
  for (const { trabajo } of listos) (trabajo.prioridad === 'alta' ? alta : normal).push(trabajo);
}

/**
 * Encola un trabajo y arranca el drenaje si estaba parado.
 *
 * El primer `tick()` se agenda (no se corre síncrono): un `for` que encola
 * varios trabajos seguidos —el caso real, `reenviarClavesDeGrupo`— tiene que
 * terminar de encolarlos TODOS antes de que la cola mire cuál va primero; si
 * el primer `tick()` corriera en el mismo tick de JS que el primer
 * `encolar()`, se llevaría ESE trabajo antes de que los de prioridad `alta`
 * encolados después existieran, y la prioridad dejaría de cumplirse.
 */
export function encolar(t: TrabajoCola): void {
  (t.prioridad === 'alta' ? alta : normal).push({ ...t, intentos: 0, primerVisto: Date.now() });
  if (!corriendo) {
    corriendo = true;
    timer = setTimeout(() => { void tick(); }, 0);
  }
}

/** Corre `ejecutar()` con un tope de tiempo (T-138-bis): si nunca resuelve,
 *  se trata como `'reintentar'` — no cuelga la cola esperándolo para
 *  siempre. No cancela la promesa original (JS no puede); si resuelve
 *  después, su resultado se pierde en silencio. */
function conTope(ejecutar: () => Promise<ResultadoTrabajo>): Promise<ResultadoTrabajo> {
  return new Promise(resolve => {
    let liquidado = false;
    const t = setTimeout(() => {
      if (liquidado) return;
      liquidado = true;
      resolve('reintentar');
    }, EJECUCION_TIMEOUT_MS);

    ejecutar().then(
      r => { if (!liquidado) { liquidado = true; clearTimeout(t); resolve(r); } },
      () => { if (!liquidado) { liquidado = true; clearTimeout(t); resolve('reintentar'); } },
    );
  });
}

async function tick(): Promise<void> {
  liberarListos();

  const cola = alta.length > 0 ? alta : normal;
  if (cola.length === 0) {
    if (enEspera.length > 0) {
      // Nada listo todavía, pero hay trabajos esperando su ventana de cuota
      // — la cola sigue "latiendo" para liberarlos cuando corresponda, sin
      // quedarse dormida para siempre.
      timer = setTimeout(() => { void tick(); }, QUEUE_INTERVAL_MS);
      return;
    }
    corriendo = false;
    return;
  }

  const trabajo = cola.shift()!;
  const resultado = await conTope(trabajo.ejecutar);
  const antiguo = Date.now() - trabajo.primerVisto > MAX_ANTIGUEDAD_MS;

  if (resultado === 'reintentar_cuota') {
    if (antiguo) {
      descartarConRastro(trabajo, 'antiguedad_cuota');
    } else {
      enEspera.push({ trabajo, listoEn: Date.now() + REINTENTO_CUOTA_MS });
    }
  } else if (resultado === 'reintentar') {
    trabajo.intentos++;
    if (trabajo.intentos >= MAX_INTENTOS_POR_TRABAJO || antiguo) {
      // R3-3(a): se descarta con rastro — es lo que impide que un trabajo
      // envenenado se coma la cola entera para siempre.
      descartarConRastro(trabajo, antiguo ? 'antiguedad' : 'max_intentos');
    } else {
      cola.unshift(trabajo);
    }
  }

  timer = setTimeout(() => { void tick(); }, QUEUE_INTERVAL_MS);
}

/** Sólo tests: vacía la cola y para el drenaje, sin dejar timers colgados
 *  entre archivos de test (el mismo cuidado que el resto del motor). */
export function __resetRelayQueue(): void {
  alta = [];
  normal = [];
  enEspera = [];
  corriendo = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function __colaLength(): number {
  return alta.length + normal.length + enEspera.length;
}
