import { noticeDeReloj, olvidarAvisoDeReloj } from '../clockNotice';
import { recordServerTime, clearClockOffset, SKEW_WARN_MS } from '@/src/utils/syncedClock';

/**
 * T-038 · Avisar que el reloj del teléfono está mal.
 *
 * `syncedNow()` corrige el merge contra el reloj del relay, así que los
 * conflictos se resuelven bien. **Lo que no corrige son las fechas que el
 * usuario ve**: un teléfono con la hora corrida muestra los gastos con la fecha
 * equivocada. Hasta hoy la app lo sabía y sólo lo mostraba en una pantalla DEV.
 *
 * Las dos propiedades que se rompen en silencio, y por eso están acá:
 * **avisa una sola vez** —se evalúa en cada publicación, cada pocos segundos— y
 * **vuelve a poder avisar cuando el reloj se arregla y se vuelve a desviar**.
 */
const HORA = 3_600_000;

/** Simula la respuesta del servidor: su hora contra la local del pedido. */
function servidorDice(desfaseMs: number): void {
  const local = Date.now();
  recordServerTime(new Date(local + desfaseMs).toISOString(), local);
}

beforeEach(() => {
  clearClockOffset();
  olvidarAvisoDeReloj();
});

describe('cuándo avisa', () => {
  it('con el reloj bien, no avisa', () => {
    servidorDice(1000);   // un segundo: ruido de red, no un reloj mal puesto
    expect(noticeDeReloj()).toBeNull();
  });

  it('sin haber hablado nunca con el relay, no avisa', () => {
    // Sin referencia el desfase es 0 y el umbral lo descarta solo. Avisar acá
    // sería acusar al reloj del usuario sin tener con qué compararlo.
    expect(noticeDeReloj()).toBeNull();
  });

  it('con el reloj corrido más de una hora, avisa', () => {
    servidorDice(HORA);
    const aviso = noticeDeReloj();
    expect(aviso).toMatchObject({ kind: 'clock_off' });
    expect(Math.abs((aviso as { offsetMs: number }).offsetMs)).toBeGreaterThan(SKEW_WARN_MS);
  });

  it('el desvío hacia atrás también avisa', () => {
    servidorDice(-HORA);
    expect(noticeDeReloj()).toMatchObject({ kind: 'clock_off' });
  });
});

describe('avisa UNA vez', () => {
  it('la segunda evaluación con el mismo desvío no vuelve a avisar', () => {
    // Se evalúa en cada publicación: sin esto serían avisos cada pocos
    // segundos, que es entrenar al usuario a ignorarlos.
    servidorDice(HORA);
    expect(noticeDeReloj()).not.toBeNull();
    expect(noticeDeReloj()).toBeNull();
    expect(noticeDeReloj()).toBeNull();
  });

  it('la marca sobrevive al reinicio de la app', () => {
    // Vive en storage, no en memoria: si viviera en memoria, cada arranque
    // avisaría lo mismo.
    servidorDice(HORA);
    expect(noticeDeReloj()).not.toBeNull();

    // Un arranque nuevo es un módulo nuevo leyendo el mismo storage.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const otro = require('../clockNotice') as typeof import('../clockNotice');
    expect(otro.noticeDeReloj()).toBeNull();
  });
});

describe('vuelve a poder avisar', () => {
  it('corregido el reloj, un desvío NUEVO avisa de nuevo', () => {
    servidorDice(HORA);
    expect(noticeDeReloj()).not.toBeNull();

    servidorDice(0);                       // el usuario arregló la hora
    expect(noticeDeReloj()).toBeNull();    // y se limpia la marca

    servidorDice(2 * HORA);                // se vuelve a desviar
    expect(noticeDeReloj()).not.toBeNull();
  });
});
