/**
 * T-147 (verificador §Simplificación, R1) · el arranque en frío NO es un
 * "cambio de cuenta".
 *
 * `subscribeSessionRehydrate` se suscribe ANTES de que `hydrate()` cargue la
 * sesión persistida (`app/_layout.tsx`: la suscripción es síncrona, `hydrate()`
 * corre después, dentro del IIFE async que espera `bootstrapSecureStorage`).
 * Con `prevId` capturado en ese momento (siempre `null`, el default de
 * `authStore`), la primera vez que `hydrate()` carga a un usuario YA
 * persistido, `nextId !== prevId` se lee como un cambio de cuenta real — y
 * dispara `reiniciarSyncPorCambioDeCuenta()`: corta el motor, vacía la cola y
 * fuerza una sesión anónima NUEVA del buzón (captcha nuevo) en cada arranque
 * en frío, aunque el usuario sea el mismo de siempre.
 *
 * El fix: la PRIMERA vez que el listener corre —sea cual sea el cambio, y
 * pase lo que pase con `nextId`/`prevId`— es siempre esa hidratación inicial
 * (nada más puede escribir `currentUser` antes: el guard de `isLoading` no
 * deja llegar a ninguna pantalla que loguee o desloguee hasta que termine).
 * Nunca cuenta como cambio de cuenta. A partir de la segunda vez, cualquier
 * cambio de id sí lo es.
 */
jest.mock('@/src/sync/relayEngine', () => ({
  startRelay: jest.fn(async () => {}),
  stopRelay: jest.fn(),
  cancelPendingPublishes: jest.fn(),
  reiniciarSyncPorCambioDeCuenta: jest.fn(),
}));
jest.mock('@/src/sync/relaySession', () => ({
  haySesionAnonimaValida: jest.fn(async () => true),
}));

import { useAuthStore } from '../authStore';
import { subscribeSessionRehydrate } from '../session';
import { useEntryGateStore, __resetEntryGate } from '../entryGateStore';
import type { User } from '@/src/types/models';

const mockReinicio = jest.requireMock('@/src/sync/relayEngine').reiniciarSyncPorCambioDeCuenta as jest.Mock;
const mockStartRelay = jest.requireMock('@/src/sync/relayEngine').startRelay as jest.Mock;
const mockHaySesion = jest.requireMock('@/src/sync/relaySession').haySesionAnonimaValida as jest.Mock;

const user = (id: string): User => ({ id, authProvider: 'google' } as User);

let unsub: () => void = () => {};

beforeEach(() => {
  mockReinicio.mockClear();
  mockStartRelay.mockClear();
  mockHaySesion.mockReset().mockResolvedValue(true);
  __resetEntryGate();
  useAuthStore.setState({ currentUser: null });
});

afterEach(() => {
  unsub(); // nunca deja un listener de un test filtrando al siguiente
  unsub = () => {};
});

describe('arranque en frío con sesión persistida', () => {
  it('la PRIMERA carga de un usuario ya persistido no cuenta como cambio de cuenta', () => {
    // Simula la suscripción síncrona ANTES de `hydrate()`, con el default
    // (`currentUser: null`) — como pasa de verdad en `app/_layout.tsx`.
    unsub = subscribeSessionRehydrate();

    // `hydrate()` carga la sesión persistida (el mismo usuario de siempre).
    useAuthStore.setState({ currentUser: user('acc-de-siempre') });

    expect(mockReinicio).not.toHaveBeenCalled();
  });

  it('sin usuario persistido (reinstalación limpia), tampoco cuenta como cambio', () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: null }); // `hydrate()` no encontró nada
    expect(mockReinicio).not.toHaveBeenCalled();
  });

  it('un cambio REAL después de la hidratación inicial sí dispara el reinicio', () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-A') }); // hidratación inicial: no cuenta

    useAuthStore.setState({ currentUser: user('acc-B') }); // cambio real A→B
    expect(mockReinicio).toHaveBeenCalledTimes(1);

    useAuthStore.setState({ currentUser: null }); // logout: también cuenta
    expect(mockReinicio).toHaveBeenCalledTimes(2);
  });

  it('login real inmediatamente después de un arranque sin usuario también dispara el reinicio', () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: null }); // hidratación inicial: sin usuario, no cuenta

    useAuthStore.setState({ currentUser: user('acc-nueva') }); // login real
    expect(mockReinicio).toHaveBeenCalledTimes(1);
  });
});

/**
 * BUG (T-147 post-merge): el captcha tiene que ser exclusivo de la entrada
 * (T-147, decisión del PO). `rehydrateForActiveUser` es el único llamador de
 * `startRelay` que corre exactamente en los momentos de entrada (hidratación
 * inicial con sesión persistida, login real, cambio de cuenta) — así que es
 * el único que debe permitir captcha.
 */
describe('BUG: el captcha sólo en la entrada', () => {
  it('la hidratación inicial (arranque en frío con sesión persistida) llama a startRelay(true)', () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-de-siempre') });

    expect(mockStartRelay).toHaveBeenCalledWith(true);
  });

  it('un cambio real de cuenta también llama a startRelay(true)', () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-A') }); // hidratación inicial
    mockStartRelay.mockClear();

    useAuthStore.setState({ currentUser: user('acc-B') }); // cambio real
    expect(mockStartRelay).toHaveBeenCalledWith(true);
  });
});

/**
 * T-147 (fila 9c/9e, decisión del PO 2026-09-27): la hidratación inicial es
 * el ÚNICO momento en el que hace falta un chequeo previo (peek, sin abrir
 * nada) para decidir si la pantalla de verificación bloqueante debe
 * aparecer. Un cambio de cuenta REAL (login/invitado/switch) no necesita
 * este chequeo: ya pide la verificación desde donde el usuario la disparó
 * (`app/auth/index.tsx`), antes de `setUser` — la sesión del buzón anterior
 * además se acaba de purgar (`reiniciarSyncPorCambioDeCuenta`), así que un
 * "peek" ahí siempre daría `false`.
 */
describe('T-147 fila 9c/9e: la verificación bloqueante sólo aparece si hace falta', () => {
  it('fila 9e: hidratación inicial CON sesión del buzón ya válida → gate termina en "lista" (la pantalla nunca aparece)', async () => {
    mockHaySesion.mockResolvedValue(true);
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-de-siempre') });

    // Mientras el chequeo corre (antes de que el await interno resuelva), el
    // gate ya está en "chequeando" — nunca "pendiente" de entrada: si
    // pasara por 'pendiente' antes de tener la respuesta real, `AuthGuard`
    // mostraría la pantalla de más, aunque sea por un instante.
    expect(useEntryGateStore.getState().estado).toBe('chequeando');

    await Promise.resolve(); await Promise.resolve();
    expect(useEntryGateStore.getState().estado).toBe('lista');
  });

  it('fila 9c: hidratación inicial SIN sesión del buzón (usuario que actualiza) → gate termina en "pendiente"', async () => {
    mockHaySesion.mockResolvedValue(false);
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-que-actualiza') });

    await Promise.resolve(); await Promise.resolve();
    expect(useEntryGateStore.getState().estado).toBe('pendiente');
  });

  it('hidratación inicial SIN usuario (reinstalación limpia): no chequea nada, el gate se queda en "ninguna"', async () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: null });

    await Promise.resolve();
    expect(mockHaySesion).not.toHaveBeenCalled();
    expect(useEntryGateStore.getState().estado).toBe('ninguna');
  });

  it('un cambio de cuenta REAL (no hidratación inicial) no dispara el chequeo — el gate ya lo pidió quien disparó el cambio', async () => {
    unsub = subscribeSessionRehydrate();
    useAuthStore.setState({ currentUser: user('acc-A') }); // hidratación inicial
    await Promise.resolve(); await Promise.resolve();
    mockHaySesion.mockClear();

    useAuthStore.setState({ currentUser: user('acc-B') }); // cambio real
    await Promise.resolve();
    expect(mockHaySesion).not.toHaveBeenCalled();
  });
});
