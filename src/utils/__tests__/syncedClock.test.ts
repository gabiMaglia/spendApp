import {
  recordServerTime, clockOffsetMs, syncedNow, hasClockReference,
  clockIsOff, clearClockOffset, SKEW_WARN_MS,
} from '../syncedClock';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * Un teléfono con la hora adelantada gana TODOS los conflictos de merge hasta
 * que el tiempo real lo alcance, en silencio. Esto lo corrige apoyándose en la
 * hora que el relay estampa en cada sobre.
 */

const HORA = (iso: string) => Date.parse(iso);

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  jest.restoreAllMocks();
});

describe('aprender el desfase', () => {
  it('un teléfono adelantado una hora queda corregido hacia atrás', () => {
    const local = HORA('2026-08-20T13:00:00Z');   // el teléfono cree que son las 13
    recordServerTime('2026-08-20T12:00:00Z', local); // el servidor dice que son las 12

    expect(clockOffsetMs()).toBe(-3600_000);
  });

  it('uno atrasado, hacia adelante', () => {
    const local = HORA('2026-08-20T12:00:00Z');
    recordServerTime('2026-08-20T13:00:00Z', local);

    expect(clockOffsetMs()).toBe(3600_000);
  });

  it('syncedNow aplica el desfase', () => {
    const local = HORA('2026-08-20T13:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(local);
    recordServerTime('2026-08-20T12:00:00Z', local);

    expect(syncedNow()).toBe(HORA('2026-08-20T12:00:00Z'));
  });

  it('la última medición reemplaza a la anterior', () => {
    recordServerTime('2026-08-20T12:00:00Z', HORA('2026-08-20T13:00:00Z'));
    recordServerTime('2026-08-20T12:00:00Z', HORA('2026-08-20T12:00:00Z'));

    expect(clockOffsetMs()).toBe(0);
  });
});

describe('sin referencia, no queda peor que antes', () => {
  it('el desfase es 0 y syncedNow es la hora local', () => {
    const local = HORA('2026-08-20T13:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(local);

    expect(hasClockReference()).toBe(false);
    expect(syncedNow()).toBe(local);
  });

  // Que falle una fecha del servidor no puede dejar el reloj peor de lo que
  // estaba: se ignora en vez de guardar un NaN que envenene todos los merges.
  it('una fecha ilegible se ignora', () => {
    recordServerTime('no es una fecha', Date.now());

    expect(hasClockReference()).toBe(false);
    expect(clockOffsetMs()).toBe(0);
  });

  it('un desfase corrupto en el storage cae a 0', () => {
    createSecureStorage('groupkeys').set('clock_offset_v1', 'cualquier cosa');

    expect(clockOffsetMs()).toBe(0);
  });
});

describe('avisar cuando el reloj está mal de verdad', () => {
  /**
   * Corregir `updatedAt` arregla el merge pero NO lo que el usuario VE: un
   * teléfono con la hora mal muestra fechas de gastos equivocadas, y eso ningún
   * desfase lo corrige.
   */
  it('un desfase grande se marca', () => {
    recordServerTime('2026-08-20T12:00:00Z', HORA('2026-08-20T13:00:00Z'));

    expect(clockIsOff()).toBe(true);
  });

  it('el ruido normal de red no', () => {
    const local = HORA('2026-08-20T12:00:00Z');
    recordServerTime('2026-08-20T12:00:02Z', local); // 2 segundos

    expect(clockIsOff()).toBe(false);
  });

  it('atrasarse cuenta igual que adelantarse', () => {
    const local = HORA('2026-08-20T12:00:00Z');
    recordServerTime(new Date(local + SKEW_WARN_MS * 2).toISOString(), local);

    expect(clockIsOff()).toBe(true);
  });

  it('sin referencia no se avisa nada: no sabemos', () => {
    expect(clockIsOff()).toBe(false);
  });
});

describe('limpieza', () => {
  it('borrar deja el dispositivo como recién instalado', () => {
    recordServerTime('2026-08-20T12:00:00Z', HORA('2026-08-20T13:00:00Z'));
    clearClockOffset();

    expect(hasClockReference()).toBe(false);
  });
});
