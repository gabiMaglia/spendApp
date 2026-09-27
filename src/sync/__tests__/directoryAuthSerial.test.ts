/**
 * El login y el logout DEL DIRECTORIO quedan serializados entre sí — un
 * logout lento no puede terminar (y "pisar" el storage) después de que el
 * login siguiente ya escribió su sesión.
 *
 * **T-147-b (Task 2, unificación de clientes):** ya no hay un
 * `directoryClient.ts` aparte — `signIntoDirectory`/`signOutOfDirectory`
 * usan `getRelayClient()` (`relay.ts`), el mismo cliente PERSISTIDO que usa
 * el buzón para una cuenta. La cola propia de este archivo sigue haciendo
 * falta por la misma razón de siempre: un logout lento no puede terminar
 * después de que el login siguiente ya escribió su sesión.
 *
 * ⚠️ Mismo esqueleto de env + `resetModules` que el resto del suite de sync.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

const orden: string[] = [];
let signOutError: { message: string } | null = null;
let signOutDelayMs = 0;
let signInDelayMs = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const signOut = jest.fn(async (_opts: { scope: string }) => {
  if (signOutDelayMs) await sleep(signOutDelayMs);
  orden.push('signOut');
  return { error: signOutError };
});
const signInWithIdToken = jest.fn(async (_args: { provider: string; token: string }) => {
  if (signInDelayMs) await sleep(signInDelayMs);
  orden.push('signIn');
  return { error: null };
});
const mockCliente = { auth: { signOut, signInWithIdToken } };
jest.mock('../relay', () => ({ getRelayClient: () => mockCliente }));

let directoryAuth: typeof import('../directoryAuth');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  orden.length = 0;
  signOutError = null;
  signOutDelayMs = 0;
  signInDelayMs = 0;
  signOut.mockClear();
  signInWithIdToken.mockClear();
  directoryAuth = require('../directoryAuth');
});

describe('el signOut del directorio no tira aunque falle por red (best effort)', () => {
  it('con error de red, signOutOfDirectory resuelve igual', async () => {
    signOutError = { message: 'Failed to fetch' };
    await expect(directoryAuth.signOutOfDirectory()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('sin error, el comportamiento normal de auth-js ya alcanza', async () => {
    signOutError = null;
    await directoryAuth.signOutOfDirectory();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('logout y login quedan serializados', () => {
  it('un signOut LENTO no puede terminar después de un login que arranca mientras tanto', async () => {
    signOutDelayMs = 50;

    const logout = directoryAuth.signOutOfDirectory(); // fire-and-forget, como en authStore.signOut()
    const login = directoryAuth.signIntoDirectory('google', 'tok'); // arranca "mientras" el logout sigue en vuelo

    await Promise.all([logout, login]);

    expect(orden).toEqual(['signOut', 'signIn']); // nunca al revés
  });

  it('al revés (login primero, logout encolado después) también respeta el orden de llegada', async () => {
    signInDelayMs = 30;

    const login = directoryAuth.signIntoDirectory('google', 'tok');
    const logout = directoryAuth.signOutOfDirectory();

    await Promise.all([login, logout]);

    expect(orden).toEqual(['signIn', 'signOut']);
  });
});
