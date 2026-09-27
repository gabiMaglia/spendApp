/**
 * T-147 (D4, ronda 2 — ruling del orquestador) · cola de envíos con ritmo por
 * debajo de la cuota del servidor (20 sobres/min). El cliente se autolimita:
 * `QUEUE_INTERVAL_MS` separa cada envío real, así que la cola NUNCA puede
 * mandar más rápido que eso, sea cual sea la cantidad de trabajos encolados.
 */
jest.mock('@/src/services/errorLog', () => ({ recordError: jest.fn() }));

import {
  encolar, __resetRelayQueue, __colaLength, QUEUE_INTERVAL_MS,
  MAX_INTENTOS_POR_TRABAJO, EJECUCION_TIMEOUT_MS, REINTENTO_CUOTA_MS,
} from '../relayQueue';
import { recordError } from '@/src/services/errorLog';

const mockRecordError = recordError as jest.Mock;

beforeEach(() => {
  __resetRelayQueue();
  mockRecordError.mockClear();
  jest.useFakeTimers();
});
afterEach(() => {
  __resetRelayQueue();
  jest.useRealTimers();
});

it('el ritmo nunca supera 60000/QUEUE_INTERVAL_MS por minuto', () => {
  expect(60_000 / QUEUE_INTERVAL_MS).toBeLessThanOrEqual(15);
});

it('procesa un trabajo enseguida, y espera QUEUE_INTERVAL_MS antes del siguiente', async () => {
  const orden: number[] = [];
  encolar({ prioridad: 'normal', ejecutar: async () => { orden.push(1); return 'hecho'; } });
  encolar({ prioridad: 'normal', ejecutar: async () => { orden.push(2); return 'hecho'; } });

  await jest.advanceTimersByTimeAsync(0);
  expect(orden).toEqual([1]);

  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS - 1);
  expect(orden).toEqual([1]); // todavía no

  await jest.advanceTimersByTimeAsync(1);
  expect(orden).toEqual([1, 2]);
});

it('los de prioridad alta van ANTES que los normales, aunque se hayan encolado después', async () => {
  const orden: string[] = [];
  encolar({ prioridad: 'normal', ejecutar: async () => { orden.push('normal-1'); return 'hecho'; } });
  encolar({ prioridad: 'alta', ejecutar: async () => { orden.push('alta-1'); return 'hecho'; } });

  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

  expect(orden).toEqual(['alta-1', 'normal-1']);
});

it('un trabajo que pide "reintentar" no se pierde: vuelve al frente y se reintenta en la vuelta siguiente', async () => {
  let intentos = 0;
  encolar({
    prioridad: 'normal',
    ejecutar: async () => { intentos++; return intentos < 3 ? 'reintentar' : 'hecho'; },
  });

  await jest.advanceTimersByTimeAsync(0);
  expect(intentos).toBe(1);
  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
  expect(intentos).toBe(2);
  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
  expect(intentos).toBe(3);
  expect(__colaLength()).toBe(0);
});

it('"descartar" no vuelve a intentarse', async () => {
  let veces = 0;
  encolar({ prioridad: 'normal', ejecutar: async () => { veces++; return 'descartar'; } });

  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS * 3);

  expect(veces).toBe(1);
  expect(__colaLength()).toBe(0);
});

it('una excepción en el trabajo cuenta como "reintentar", nunca se pierde', async () => {
  let veces = 0;
  encolar({
    prioridad: 'normal',
    ejecutar: async () => { veces++; if (veces < 2) throw new Error('boom'); return 'hecho'; },
  });

  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

  expect(veces).toBe(2);
  expect(__colaLength()).toBe(0);
});

/**
 * Verifier R3-3(a) (ronda 3): un trabajo que SIEMPRE falla (PoC real: una
 * `wrapPublicKey` inválida hace tirar `wrapGroupKey` con `RangeError`,
 * "envenenando" el reenvío de ese contacto) no puede bloquear la cola para
 * siempre. 901 reintentos en 1h del PoC — el resto de la cola (los otros 10
 * trabajos) no avanzó NADA. El tope por trabajo lo descarta con un rastro en
 * el diagnóstico (`errorLog`) y la cola sigue con el resto.
 */
describe('R3-3(a): tope de reintentos por trabajo', () => {
  it('un trabajo envenenado (siempre "reintentar") se descarta tras MAX_INTENTOS_POR_TRABAJO, con rastro', async () => {
    let intentosEnvenenado = 0;
    encolar({ prioridad: 'normal', ejecutar: async () => { intentosEnvenenado++; return 'reintentar'; } });
    const sano = jest.fn(async () => 'hecho' as const);
    encolar({ prioridad: 'normal', ejecutar: sano });

    // El envenenado va primero (FIFO), así que bloquea al sano hasta que se
    // agote — exactamente el "bloqueo en cabeza" del PoC.
    for (let i = 0; i < MAX_INTENTOS_POR_TRABAJO + 2; i++) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
    }

    expect(intentosEnvenenado).toBe(MAX_INTENTOS_POR_TRABAJO); // no 901
    expect(mockRecordError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false }));
    expect(sano).toHaveBeenCalled(); // la cola SIGUIÓ con el resto
    expect(__colaLength()).toBe(0);
  });
});

/**
 * Verifier R3-3(a), hallazgo hostil: `ejecutar` sin `withTimeout` (regla
 * T-138-bis) — un envío colgado dejaba `corriendo=true` para siempre y los
 * `encolar` siguientes nunca arrancaban (PoC: 0 hechos en 1h).
 */
describe('R3-3(b): tope de tiempo por envío', () => {
  it('un trabajo que nunca resuelve vence a EJECUCION_TIMEOUT_MS y se trata como "reintentar"', async () => {
    encolar({ prioridad: 'normal', ejecutar: () => new Promise(() => {}) }); // se cuelga
    const sano = jest.fn(async () => 'hecho' as const);
    encolar({ prioridad: 'normal', ejecutar: sano });

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(EJECUCION_TIMEOUT_MS);
    // El colgado vuelve al frente (reintentar) — hay que dejarlo agotar su
    // tope de intentos para que la cola llegue al trabajo sano.
    for (let i = 0; i < MAX_INTENTOS_POR_TRABAJO; i++) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS + EJECUCION_TIMEOUT_MS);
    }

    expect(sano).toHaveBeenCalled();
  });
});

/**
 * Verifier R4-2 (ronda 4): el tope de reintentos (8, ~32s) es MENOR que la
 * ventana de cuota real (el minuto de calendario, `011a`). PoC del
 * verificador: 13 tarjetas + 11 claves `alta` de un grupo nuevo en el mismo
 * minuto → la clave #7 se descartaba a los ~56s, JUSTO antes de que la cuota
 * se renovara — un fallo transitorio (rate_limited) se trataba igual que uno
 * permanente. `'reintentar_cuota'` es un resultado aparte: no cuenta para
 * `MAX_INTENTOS_POR_TRABAJO`, y su espera está alineada a la ventana de
 * cuota (`REINTENTO_CUOTA_MS` ⇒ 60s), no al ritmo normal de la cola. Sólo un
 * backstop de horas (no ~32s) lo descarta.
 */
describe('R4-2: rate_limited no cuenta para el tope de reintentos', () => {
  it('"reintentar_cuota" sobrevive MUCHO más que MAX_INTENTOS_POR_TRABAJO sin descartarse', async () => {
    let intentos = 0;
    encolar({
      prioridad: 'alta',
      ejecutar: async () => { intentos++; return intentos <= MAX_INTENTOS_POR_TRABAJO + 2 ? 'reintentar_cuota' : 'hecho'; },
    });

    for (let i = 0; i < MAX_INTENTOS_POR_TRABAJO + 4; i++) {
      await jest.advanceTimersByTimeAsync(REINTENTO_CUOTA_MS);
    }

    expect(intentos).toBeGreaterThan(MAX_INTENTOS_POR_TRABAJO); // superó el tope viejo y no se descartó
    expect(mockRecordError).not.toHaveBeenCalled();
    expect(__colaLength()).toBe(0);
  });

  it('espera al menos REINTENTO_CUOTA_MS (≥60s) antes de reintentar, no el ritmo normal', async () => {
    let intentos = 0;
    encolar({ prioridad: 'alta', ejecutar: async () => { intentos++; return intentos < 2 ? 'reintentar_cuota' : 'hecho'; } });

    await jest.advanceTimersByTimeAsync(0);
    expect(intentos).toBe(1);

    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS * 3); // el ritmo normal NO alcanza
    expect(intentos).toBe(1);

    await jest.advanceTimersByTimeAsync(REINTENTO_CUOTA_MS);
    expect(intentos).toBe(2);
  });

  it('otro trabajo sano no espera detrás de uno en "reintentar_cuota" (no bloquea en cabeza)', async () => {
    encolar({ prioridad: 'normal', ejecutar: async () => 'reintentar_cuota' });
    const sano = jest.fn(async () => 'hecho' as const);
    encolar({ prioridad: 'normal', ejecutar: sano });

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

    expect(sano).toHaveBeenCalled();
  });

  it('REINTENTO_CUOTA_MS está alineado a la ventana de cuota (≥60s)', () => {
    expect(REINTENTO_CUOTA_MS).toBeGreaterThanOrEqual(60_000);
  });
});

/**
 * Medición pedida por el orquestador: 3×4, 5×5, 5×8 (grupos×miembros).
 * Sobres = grupos × (miembros − 1) — cada uno excluye al propio dueño.
 */
describe.each([
  [3, 4, 9],
  [5, 5, 20],
  [5, 8, 35],
])('arranque en frío: %i grupos × %i miembros (%i sobres)', (grupos, miembros, sobresEsperados) => {
  it('nunca supera 15/min y no pierde ninguno', async () => {
    const total = grupos * (miembros - 1);
    expect(total).toBe(sobresEsperados);

    let enviados = 0;
    for (let i = 0; i < total; i++) {
      encolar({ prioridad: 'normal', ejecutar: async () => { enviados++; return 'hecho'; } });
    }

    let vueltas = 0;
    while (__colaLength() > 0 && vueltas < 200) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
      vueltas++;
    }

    const segundos = vueltas * (QUEUE_INTERVAL_MS / 1000);
    const porMinuto = total / (segundos / 60);

    expect(enviados).toBe(total); // nada se pierde
    // El primer envío sale "gratis" (t=0, ráfaga chica explícitamente
    // aceptada por el ruling); el resto respeta el intervalo. Para un lote
    // chico esa gratuidad infla el promedio medido por sobre el
    // asintótico (60000/QUEUE_INTERVAL_MS = 15/min) — el techo real, medido
    // en régimen (excluyendo el primero), sí es 15/min exactas.
    expect(porMinuto).toBeLessThanOrEqual(17);
    const regimen = (total - 1) / (segundos / 60);
    expect(regimen).toBeLessThanOrEqual(15);
    // eslint-disable-next-line no-console
    console.log(`[medición D4] ${grupos}×${miembros}: ${total} sobres, ~${segundos.toFixed(1)}s, ${porMinuto.toFixed(1)}/min (${regimen.toFixed(1)}/min en régimen)`);
  });
});
