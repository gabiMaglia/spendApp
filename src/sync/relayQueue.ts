/**
 * Cola de envíos con ritmo por debajo de la cuota del servidor (T-147 D4,
 * ronda 2 — ruling del orquestador: "la cuota del PO (20 sobres/min) NO
 * cambia. El cliente se autolimita").
 *
 * Todo lo que manda un lote de sobres FUERA de la publicación normal de un
 * grupo —que ya es 1 pedido por grupo por vuelta de poll, ver
 * `relayEngine.reintentarPublicacionesConCuota`— pasa por acá: hoy,
 * `reenviarClavesDeGrupo`. Sin esto, un arranque con varios grupos grandes
 * manda todos los sobres de clave en una ráfaga sin ritmo (medido en la
 * ronda 2 del verifier: 5 grupos × 8 miembros = 35 sobres de una, contra una
 * cuota de 20/min).
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
 * Un trabajo que devuelve `'reintentar'` (rate_limited, red) vuelve al
 * FRENTE de su prioridad — nunca se pierde, y no revive antes de la próxima
 * vuelta del ritmo, así que reintentarlo no puede ráfaguear.
 */

export type ResultadoTrabajo = 'hecho' | 'reintentar' | 'descartar';
export type TrabajoCola = { prioridad: 'alta' | 'normal'; ejecutar: () => Promise<ResultadoTrabajo> };

/** 60_000 / 4_000 = 15/min como máximo — por debajo de la cuota real (20/min). */
export const QUEUE_INTERVAL_MS = 4_000;

let alta: TrabajoCola[] = [];
let normal: TrabajoCola[] = [];
let corriendo = false;
let timer: ReturnType<typeof setTimeout> | null = null;

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
  (t.prioridad === 'alta' ? alta : normal).push(t);
  if (!corriendo) {
    corriendo = true;
    timer = setTimeout(() => { void tick(); }, 0);
  }
}

async function tick(): Promise<void> {
  const cola = alta.length > 0 ? alta : normal;
  if (cola.length === 0) {
    corriendo = false;
    return;
  }

  const trabajo = cola.shift()!;
  let resultado: ResultadoTrabajo;
  try {
    resultado = await trabajo.ejecutar();
  } catch {
    // Una excepción no puede perder el trabajo — mismo trato que `network`.
    resultado = 'reintentar';
  }
  if (resultado === 'reintentar') cola.unshift(trabajo);

  timer = setTimeout(() => { void tick(); }, QUEUE_INTERVAL_MS);
}

/** Sólo tests: vacía la cola y para el drenaje, sin dejar timers colgados
 *  entre archivos de test (el mismo cuidado que el resto del motor). */
export function __resetRelayQueue(): void {
  alta = [];
  normal = [];
  corriendo = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function __colaLength(): number {
  return alta.length + normal.length;
}
