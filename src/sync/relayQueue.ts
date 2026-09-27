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
 * Un trabajo que devuelve `'reintentar'` (rate_limited, red) vuelve al
 * FRENTE de su prioridad — nunca se pierde, y no revive antes de la próxima
 * vuelta del ritmo, así que reintentarlo no puede ráfaguear.
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
 */

import { recordError } from '@/src/services/errorLog';

export type ResultadoTrabajo = 'hecho' | 'reintentar' | 'descartar';
export type TrabajoCola = { prioridad: 'alta' | 'normal'; ejecutar: () => Promise<ResultadoTrabajo> };

/** 60_000 / 4_000 = 15/min como máximo — por debajo de la cuota real (20/min). */
export const QUEUE_INTERVAL_MS = 4_000;

/** Tope de reintentos por trabajo antes de descartarlo con rastro. Con
 *  `QUEUE_INTERVAL_MS` de espera entre cada uno, agotarlo tarda ~32s — mucho
 *  antes de que un solo trabajo envenenado se coma una hora entera. */
export const MAX_INTENTOS_POR_TRABAJO = 8;

/** Igual de generoso que el resto del motor (`STARTUP_TIMEOUT_MS`,
 *  `SESSION_TIMEOUT_MS`): un envío real nunca debería tardar esto. */
export const EJECUCION_TIMEOUT_MS = 15_000;

type TrabajoInterno = TrabajoCola & { intentos: number };

let alta: TrabajoInterno[] = [];
let normal: TrabajoInterno[] = [];
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
  (t.prioridad === 'alta' ? alta : normal).push({ ...t, intentos: 0 });
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
  const cola = alta.length > 0 ? alta : normal;
  if (cola.length === 0) {
    corriendo = false;
    return;
  }

  const trabajo = cola.shift()!;
  const resultado = await conTope(trabajo.ejecutar);

  if (resultado === 'reintentar') {
    trabajo.intentos++;
    if (trabajo.intentos >= MAX_INTENTOS_POR_TRABAJO) {
      // R3-3(a): se descarta con rastro — es lo que impide que un trabajo
      // envenenado se coma la cola entera para siempre.
      recordError({
        message: `relayQueue.trabajo_descartado prioridad=${trabajo.prioridad} intentos=${trabajo.intentos}`,
        fatal: false,
        screen: 'sync',
      });
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
  corriendo = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function __colaLength(): number {
  return alta.length + normal.length;
}
