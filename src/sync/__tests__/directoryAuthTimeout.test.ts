/**
 * T-175 (obs verifier T-147-b ronda 2, 2026-09-27): `signInWithIdToken`/
 * `signOut` encolados en `directoryAuth.ts` corrían SIN tope de tiempo — un
 * fetch colgado bloqueaba la cola COMPARTIDA con `ensureRelaySession`
 * (`relaySession.ts`, fix D1) para siempre, porque el tope de
 * `SESSION_TIMEOUT_MS` vive DENTRO de `hacerEnsure` (envolviendo lo que
 * ensureRelaySession encola) y nunca llega a lo que ya estaba encolado
 * ADELANTE. `verify.tsx` quedaba en spinner sin salida.
 *
 * Mismo esqueleto que `directoryAuthSerial.test.ts`: se mockea sólo
 * `../relay` (el cliente de Supabase) y se deja correr la cola REAL —
 * incluida la de `relaySession.ts`, que es la MISMA (fix D1, T-147-b).
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let signOutError: { message: string } | null = null;
const signOut = jest.fn(async (_opts: { scope: string }) => ({ error: signOutError }));
const signInWithIdToken = jest.fn(async (_args: { provider: string; token: string }) => ({ error: null as { message: string } | null }));
const getSession = jest.fn(async () => ({ data: { session: null as unknown }, error: null }));
const mockCliente = { auth: { signOut, signInWithIdToken, getSession } };
jest.mock('../relay', () => ({ getRelayClient: () => mockCliente }));

let directoryAuth: typeof import('../directoryAuth');
let relaySession: typeof import('../relaySession');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  signOutError = null;
  signOut.mockClear();
  signInWithIdToken.mockClear();
  getSession.mockClear();
  directoryAuth = require('../directoryAuth');
  relaySession = require('../relaySession');
  relaySession.__resetRelaySession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as never });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('login colgado: se vence a SESSION_TIMEOUT_MS y libera la cola', () => {
  it('signIntoDirectory resuelve rechazado al vencer, en vez de colgarse para siempre', async () => {
    jest.useFakeTimers();
    signInWithIdToken.mockImplementationOnce(() => new Promise(() => {})); // nunca contesta

    const login = directoryAuth.signIntoDirectory('google', 'tok');
    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);

    const resultado = await login;
    expect(resultado.ok).toBe(false);
  });

  it('libera la cola: un ensureRelaySession encolado DETRÁS corre con su propio tope, no se queda colgado para siempre', async () => {
    jest.useFakeTimers();
    signInWithIdToken.mockImplementationOnce(() => new Promise(() => {})); // nunca contesta

    const login = directoryAuth.signIntoDirectory('google', 'tok'); // item #1, colgado
    const ensure = relaySession.ensureRelaySession(true); // item #2, detrás en la MISMA cola (fix D1)

    // Un solo tope (no dos en serie): la cola se libera a tiempo para que el
    // ensure encolado detrás corra y resuelva con su PROPIO presupuesto —
    // getSession() no está colgado, así que no necesita más que el resto del
    // primer tope para terminar.
    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);

    expect((await login).ok).toBe(false);
    expect(await ensure).toBe('none'); // no queda colgado para siempre
  });

  it('un login SIN cuelgue no espera nada — usuario normal sin cambios', async () => {
    signInWithIdToken.mockResolvedValueOnce({ error: null });
    const resultado = await directoryAuth.signIntoDirectory('google', 'tok');
    expect(resultado.ok).toBe(true);
  });
});

describe('logout colgado de A: se vence y purga la sesión LOCAL', () => {
  it('al vencer, purga el storage local aunque la red de signOut nunca haya contestado', async () => {
    jest.useFakeTimers();
    relaySession.supabaseAuthStorage().setItem('sb-jwt-de-A', 'token-viejo-de-A');
    signOut.mockImplementationOnce(() => new Promise(() => {})); // nunca contesta

    const logout = directoryAuth.signOutOfDirectory();
    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);
    await logout;

    expect(relaySession.supabaseAuthStorage().getItem('sb-jwt-de-A')).toBeNull();
  });

  it('libera la cola: un login de B encolado detrás sí entra', async () => {
    jest.useFakeTimers();
    signOut.mockImplementationOnce(() => new Promise(() => {})); // logout de A colgado
    signInWithIdToken.mockResolvedValueOnce({ error: null }); // login de B, normal

    const logoutA = directoryAuth.signOutOfDirectory();
    const loginB = directoryAuth.signIntoDirectory('google', 'tok-de-B');

    await jest.advanceTimersByTimeAsync(relaySession.SESSION_TIMEOUT_MS + 1);
    await logoutA;

    expect((await loginB).ok).toBe(true);
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'tok-de-B' });
  });

  it('un logout SIN cuelgue no espera nada — usuario normal sin cambios', async () => {
    signOutError = null;
    await directoryAuth.signOutOfDirectory();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
