/**
 * T-175 (verifier ronda 2, RECHAZO — B2i): `withTimeout` deja de ESPERAR la
 * promesa de `signInWithIdToken` cuando vence, pero no la CANCELA (JS no
 * puede) — y auth-js tampoco se entera de nuestro tope: en cuanto la red
 * conteste, igual corre `_saveSession` y persiste esa respuesta tardía
 * (`GoTrueClient.js:1685-1687`), sin importar que ya hayamos dejado de
 * esperarla. Reproducido por el verifier: A vence a los 20s → B entra
 * (Apple) → llega la respuesta tardía de A → el storage queda con el JWT de
 * A pisando el de B.
 *
 * Fix (B2i): `signIntoDirectory` sigue mirando la promesa ORIGINAL después
 * de vencida (`vigilarRespuestaTardia`); si trae una sesión Y el
 * `access_token` que trajo es EXACTAMENTE el que quedó persistido en ese
 * momento, se purga. La comparación es la que evita tocar una sesión ajena
 * (si B ya escribió la suya, el token no coincide y no se toca nada).
 *
 * Mismo esqueleto que `directoryAuthTimeout.test.ts`: sólo se mockea
 * `../relay` (el cliente), la cola y `relaySession.ts` corren reales.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

type SesionMock = { access_token: string; user: { id: string; is_anonymous: boolean } };
let sesionActual: SesionMock | null = null;

const signInWithIdToken = jest.fn(async (_args: { provider: string; token: string }) => ({
  data: { session: null as SesionMock | null },
  error: null as { message: string } | null,
}));
const getSession = jest.fn(async () => ({ data: { session: sesionActual }, error: null }));
const signOut = jest.fn(async () => ({ error: null }));
const mockCliente = { auth: { signInWithIdToken, signOut, getSession } };
jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({ getRelayClient: () => mockCliente }));

let directoryAuth: typeof import('../directoryAuth');
let relaySession: typeof import('../relaySession');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  sesionActual = null;
  signInWithIdToken.mockClear();
  getSession.mockClear();
  signOut.mockClear();
  directoryAuth = require('../directoryAuth');
  relaySession = require('../relaySession');
  relaySession.__resetRelaySession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;
  useAuthStore.setState({ currentUser: { id: 'A', authProvider: 'google' } as never });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('B2i: la respuesta tardía de un login VENCIDO purga si coincide con lo persistido', () => {
  it('el login de A vence, después llega tarde con el mismo token que quedó guardado → se purga', async () => {
    jest.useFakeTimers();
    let liberar: ((v: { data: { session: SesionMock | null }; error: null }) => void) | null = null;
    signInWithIdToken.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; }));

    const login = directoryAuth.signIntoDirectory('google', 'tok-A');
    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);
    expect((await login).ok).toBe(false); // vencido

    // Marca en el storage real para poder confirmar que se limpió.
    relaySession.supabaseAuthStorage().setItem('marca', 'antes-de-la-respuesta-tardia');

    // Llega tarde: auth-js YA la persistió (por eso getSession pasa a verla).
    const sesionTardia: SesionMock = { access_token: 'tok-tardio-de-A', user: { id: 'A', is_anonymous: false } };
    sesionActual = sesionTardia;
    liberar!({ data: { session: sesionTardia }, error: null });

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);

    expect(relaySession.supabaseAuthStorage().getItem('marca')).toBeNull(); // purgado
  });

  it('(negativo) si lo persistido es de OTRA sesión (B ya entró), nunca la toca', async () => {
    jest.useFakeTimers();
    let liberar: ((v: { data: { session: SesionMock | null }; error: null }) => void) | null = null;
    signInWithIdToken.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; }));

    const login = directoryAuth.signIntoDirectory('google', 'tok-A');
    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);
    await login;

    // Mientras tanto, B ya entró con su propia sesión — DISTINTO access_token.
    sesionActual = { access_token: 'tok-de-B', user: { id: 'B', is_anonymous: false } };
    relaySession.supabaseAuthStorage().setItem('marca', 'sesion-de-B');

    // A llega tarde con SU token — no el que está persistido ahora.
    const sesionTardia: SesionMock = { access_token: 'tok-tardio-de-A', user: { id: 'A', is_anonymous: false } };
    liberar!({ data: { session: sesionTardia }, error: null });

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);

    // Nunca se tocó una sesión ajena: la marca de B sigue intacta.
    expect(relaySession.supabaseAuthStorage().getItem('marca')).toBe('sesion-de-B');
  });

  it('si el login NO vence, no hay nada que vigilar después — camino normal sin cambios', async () => {
    signInWithIdToken.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-A', user: { id: 'A', is_anonymous: false } } },
      error: null,
    });
    const r = await directoryAuth.signIntoDirectory('google', 'tok-A');
    expect(r.ok).toBe(true);
  });
});
