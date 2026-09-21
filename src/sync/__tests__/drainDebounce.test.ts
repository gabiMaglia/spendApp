/**
 * Revisión final, Fix 1 (crítico): con ADR-007 una publicación manda K+1
 * sobres (K rebanadas + 1 manifiesto) en vez de uno solo, y cada INSERT
 * dispara su propio aviso realtime por separado (`subscribeTopic`, sin
 * agrupar). Sin coalescer esos avisos, una ráfaga de K+1 avisos de una MISMA
 * publicación disparaba K+1 `drainNow` superpuestos: cada uno adelantaba el
 * cursor, así que para cuando el aviso del manifiesto llegaba a disparar SU
 * drenaje, las rebanadas de datos ya habían sido aplicadas por drenajes
 * anteriores — ese drenaje veía sólo el manifiesto, y el chequeo de gaps de
 * `drainGroup` reportaba TODAS las ckeys declaradas como "faltantes" aunque
 * hubieran llegado bien.
 *
 * Este archivo prueba las dos piezas del arreglo:
 *  1. `scheduleDrain` agrupa una ráfaga de avisos del MISMO grupo en un solo
 *     `drainGroup` (mismo patrón que `schedulePublish` para publicaciones).
 *  2. El disparo agendado por un aviso no arranca un segundo drenaje si ya
 *     hay uno de ese MISMO origen en curso para el grupo (hallazgo m6,
 *     "amplificación por drenaje concurrente").
 *
 * A propósito NO se prueba acá que `drainNow` en sí mismo dedupe llamadas
 * concurrentes de cualquier origen: `elegirClaveDeGrupo` (T-136 · D-1)
 * depende de poder llamar a `drainNow` para un grupo mientras un drenaje
 * ANTERIOR de ese mismo grupo (con una clave vieja, en disputa) todavía está
 * en vuelo — ver `drenajeEnVueloTrasElegir.test.ts`, que es exactamente la
 * regresión que un candado global sobre `drainNow` rompería. Por eso el
 * candado de esta revisión vive en el despacho de `scheduleDrain`, no en
 * `drainNow`.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('../relaySync', () => ({
  drainGroup: jest.fn(async () => ({ ok: true, applied: 0, skipped: 0, cursor: 1 })),
  sigueSiendoLaClave: jest.fn(() => true),
  publishToGroup: jest.fn(async () => ({ ok: true, seq: 1 })),
}));

import {
  scheduleDrain, cancelPendingDrains, DRAIN_DEBOUNCE_MS, stopRelay,
} from '../relayEngine';
import { drainGroup } from '../relaySync';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const ME = 'u1';

function setUpGrupoConClave(): void {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: ME } as User });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('g1');
  useGroupKeyStore.getState().ensureKey('g2');
}

describe('scheduleDrain: coalesce de avisos realtime (Fix 1)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cancelPendingDrains();
    (drainGroup as jest.Mock).mockReset();
    (drainGroup as jest.Mock).mockImplementation(async () => ({ ok: true, applied: 0, skipped: 0, cursor: 1 }));
    setUpGrupoConClave();
  });

  afterEach(() => {
    cancelPendingDrains();
    stopRelay();
    jest.useRealTimers();
  });

  it('K+1 avisos seguidos del mismo grupo producen UN solo drainGroup', async () => {
    // Simula la ráfaga de K+1 sobres (rebanadas + manifiesto) de una misma
    // publicación, cada uno con su propio INSERT/aviso realtime.
    scheduleDrain('g1');
    scheduleDrain('g1');
    scheduleDrain('g1');
    scheduleDrain('g1');
    scheduleDrain('g1');

    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);

    expect(drainGroup).toHaveBeenCalledTimes(1);
  });

  it('nada se dispara antes de que la ventana de debounce termine', () => {
    scheduleDrain('g1');
    jest.advanceTimersByTime(DRAIN_DEBOUNCE_MS - 1);
    expect(drainGroup).not.toHaveBeenCalled();
  });

  it('cancelar deja el sistema limpio: nada se dispara después', async () => {
    scheduleDrain('g1');
    cancelPendingDrains();

    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);

    expect(drainGroup).not.toHaveBeenCalled();
  });

  it('grupos distintos no se coalescen entre sí', async () => {
    scheduleDrain('g1');
    scheduleDrain('g2');

    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);

    expect(drainGroup).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleDrain: candado de drenaje agendado en curso (Fix 1 / hallazgo m6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cancelPendingDrains();
    (drainGroup as jest.Mock).mockReset();
    setUpGrupoConClave();
  });

  afterEach(() => {
    cancelPendingDrains();
    stopRelay();
    jest.useRealTimers();
  });

  it('un aviso que llega mientras el drenaje agendado anterior sigue en curso no dispara uno nuevo', async () => {
    let resolver!: (v: { ok: true; applied: number; skipped: number; cursor: number }) => void;
    (drainGroup as jest.Mock).mockImplementationOnce(
      () => new Promise(res => { resolver = res; }),
    );

    scheduleDrain('g1');
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50); // dispara el primer drenaje agendado; queda pendiente
    expect(drainGroup).toHaveBeenCalledTimes(1);
    expect(resolver).toBeDefined();

    // Llega OTRO aviso (otra ráfaga, otra publicación) mientras el anterior
    // sigue sin resolver — simula el caso real: la ráfaga del manifiesto de
    // una publicación posterior llega mientras el drenaje de la publicación
    // anterior todavía no terminó de leer la red.
    scheduleDrain('g1');
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);

    // No se arrancó un segundo drenaje: el que ya estaba en curso lo cubre.
    expect(drainGroup).toHaveBeenCalledTimes(1);

    resolver({ ok: true, applied: 0, skipped: 0, cursor: 1 });
    await Promise.resolve();
    await Promise.resolve(); // deja asentar el `.finally` que libera el candado

    // Terminado el anterior, un aviso nuevo sí dispara otro drenaje.
    scheduleDrain('g1');
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);
    expect(drainGroup).toHaveBeenCalledTimes(2);
  });

  it('el candado es por grupo: un drenaje en curso de g1 no bloquea el de g2', async () => {
    let resolverG1!: (v: unknown) => void;
    (drainGroup as jest.Mock).mockImplementation((groupId: string) => {
      if (groupId === 'g1') return new Promise(res => { resolverG1 = res; });
      return Promise.resolve({ ok: true, applied: 0, skipped: 0, cursor: 1 });
    });

    scheduleDrain('g1');
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);
    expect(resolverG1).toBeDefined();

    scheduleDrain('g2');
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS + 50);

    expect(drainGroup).toHaveBeenCalledTimes(2); // g1 (pendiente) + g2 (resuelto)

    resolverG1({ ok: true, applied: 0, skipped: 0, cursor: 1 });
    await Promise.resolve();
  });
});
