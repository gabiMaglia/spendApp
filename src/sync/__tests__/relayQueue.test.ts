/**
 * T-147 (D4, ronda 2 — ruling del orquestador) · cola de envíos con ritmo por
 * debajo de la cuota del servidor (20 sobres/min). El cliente se autolimita:
 * `QUEUE_INTERVAL_MS` separa cada envío real, así que la cola NUNCA puede
 * mandar más rápido que eso, sea cual sea la cantidad de trabajos encolados.
 */
import { encolar, __resetRelayQueue, __colaLength, QUEUE_INTERVAL_MS } from '../relayQueue';

beforeEach(() => {
  __resetRelayQueue();
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
