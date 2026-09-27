/**
 * T-175 (verifier ronda 2, RECHAZO — B1 y B2ii): dos huecos más en la cola
 * compartida de sesión del buzón (`relaySession.ts`), además del que ya
 * arregló la primera vuelta de T-175 (`directoryAuthTimeout.test.ts`).
 *
 * **B1 — logout colgado por OTRO camino.** El logout normal
 * (`authStore.signOut` → `directoryAuth.signOutOfDirectory`, ya con tope)
 * no es el único que cierra la sesión del buzón: todo cambio de cuenta pasa
 * TAMBIÉN por `reiniciarSyncPorCambioDeCuenta` → `reabrirSesionAnonima`
 * (`relaySession.ts:387-393`), que encola `purgarSesionLocal` (`:110-117`).
 * Esa función llamaba a `supabase.auth.signOut({ scope: 'local' })` SIN
 * tope — un fetch colgado ahí bloqueaba la MISMA cola compartida
 * (`encolarOperacionDeSesion`, fix D1) para siempre, y la cuenta B que
 * entraba después nunca conseguía leer su propia sesión.
 *
 * **B2ii — defensa general contra un JWT ajeno persistido.** Si por
 * cualquier motivo (p.ej. la respuesta tardía de un login vencido — B2i,
 * `directoryAuthLateArrival.test.ts`) el storage termina con la sesión de
 * OTRA cuenta, `ensureRelaySession` devolvía `'identity'` igual: sólo
 * miraba `is_anonymous`, nunca A QUIÉN pertenecía la sesión. Acá se prueba
 * la defensa reactiva, sin depender de cómo llegó el JWT ajeno.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let sesion: { user: { is_anonymous?: boolean; id?: string } } | null = null;
const signOut = jest.fn(async (_opts: { scope: string }) => ({ error: null as { message: string } | null }));
const getSession = jest.fn(async () => ({ data: { session: sesion }, error: null as { message: string } | null }));
const signInAnonymously = jest.fn();
const mockCliente = {
  auth: {
    getSession,
    signOut,
    signInAnonymously,
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockCliente),
}));

let S: typeof import('../relaySession');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  sesion = null;
  signOut.mockClear();
  getSession.mockClear();
  signInAnonymously.mockClear();
  S = require('../relaySession');
  S.__resetRelaySession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('B1: logout colgado (reabrirSesionAnonima) no bloquea la cola para siempre', () => {
  it('sesión A + logout colgado → B entra igual, sin esperar más que SESSION_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    useAuthStore.setState({ currentUser: { id: 'A', authProvider: 'google' } as never });
    sesion = { user: { id: 'A', is_anonymous: false } };

    signOut.mockImplementationOnce(() => new Promise(() => {})); // logout de A: nunca contesta

    // Cambio de cuenta A→B: dispara el reinicio (logout colgado, encolado).
    const reinicio = S.reabrirSesionAnonima();

    // B ya está activo cuando `startRelay` (llamado por
    // `rehydrateForActiveUser`) pide su propia lectura — encolada DETRÁS del
    // logout colgado, en la MISMA cola (fix D1).
    useAuthStore.setState({ currentUser: { id: 'B', authProvider: 'apple' } as never });
    sesion = { user: { id: 'B', is_anonymous: false } };
    const bEnsure = S.ensureRelaySession(true);

    await jest.advanceTimersByTimeAsync(S.SESSION_TIMEOUT_MS + 1);

    await reinicio; // el logout venció — no se quedó colgado para siempre
    expect(await bEnsure).toBe('identity'); // B pudo leer su propia sesión
  });

  it('un logout SIN cuelgue no espera nada — usuario normal sin cambios', async () => {
    useAuthStore.setState({ currentUser: { id: 'A', authProvider: 'google' } as never });
    sesion = { user: { id: 'A', is_anonymous: false } };
    await S.reabrirSesionAnonima();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('B2ii: defensa general — sesión guardada que no es de la cuenta activa', () => {
  it('sesión de OTRA cuenta persistida (p.ej. un JWT viejo pisado) → purga + none, NUNCA identity', async () => {
    useAuthStore.setState({ currentUser: { id: 'B', authProvider: 'apple' } as never });
    sesion = { user: { id: 'A', is_anonymous: false } }; // el JWT de A quedó en el storage

    const kind = await S.ensureRelaySession(true);

    expect(kind).toBe('none'); // nunca 'identity' con el JWT de otra cuenta
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' }); // se purgó
  });

  it('sesión de la MISMA cuenta activa → identity, sin tocar nada (el camino feliz no se rompe)', async () => {
    useAuthStore.setState({ currentUser: { id: 'B', authProvider: 'apple' } as never });
    sesion = { user: { id: 'B', is_anonymous: false } };

    expect(await S.ensureRelaySession(true)).toBe('identity');
    expect(signOut).not.toHaveBeenCalled();
  });
});
