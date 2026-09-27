/**
 * T-147 (R3-2, verifier ronda 3) · invitado → cuenta: el logout de la sesión
 * anónima tiene que:
 *  (a) borrar el storage LOCAL aunque `signOut` falle por red (auth-js NO lo
 *      hace sola: `_signOut` sólo llega a `_removeSession()` si el viaje de
 *      red no tira un error "raro" — `GoTrueClient.js`, scope `'local'`
 *      incluido);
 *  (b) estar SERIALIZADO respecto del login siguiente: un logout lento no
 *      puede terminar (y borrar) DESPUÉS de que el login ya escribió la
 *      sesión de cuenta.
 *
 * ⚠️ Mismo esqueleto de env + `resetModules` que `relayPrenda.test.ts`.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

const orden: string[] = [];
let sesion: { user: { is_anonymous: boolean } } | null = null;
let signOutError: { message: string } | null = null;
let signOutDelayMs = 0;
let signInDelayMs = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const signOut = jest.fn(async (_opts: { scope: string }) => {
  if (signOutDelayMs) await sleep(signOutDelayMs);
  orden.push('signOut');
  // Fiel a auth-js: si hay error de red, NO se toca `sesion` (no llega a
  // `_removeSession`). Sin error, `scope: 'local'` sí la borra.
  if (signOutError) return { error: signOutError };
  sesion = null;
  return { error: null };
});
const signInWithIdToken = jest.fn(async (_args: { provider: string; token: string }) => {
  if (signInDelayMs) await sleep(signInDelayMs);
  orden.push('signIn');
  sesion = { user: { is_anonymous: false } };
  return { error: null };
});
const mockCliente = { auth: { signOut, signInWithIdToken } };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockCliente) }));

let directoryAuth: typeof import('../directoryAuth');
let relaySession: typeof import('../relaySession');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  orden.length = 0;
  sesion = null;
  signOutError = null;
  signOutDelayMs = 0;
  signInDelayMs = 0;
  signOut.mockClear();
  signInWithIdToken.mockClear();
  directoryAuth = require('../directoryAuth');
  relaySession = require('../relaySession');
});

describe('R3-2(a): el storage se borra aunque signOut falle por red', () => {
  it('con error de red, igual queda sin sesión persistida (borrado forzado)', async () => {
    const st = relaySession.supabaseAuthStorage();
    st.setItem('sb-fake-auth-token', JSON.stringify({ vieja: 'anonima' }));
    signOutError = { message: 'Failed to fetch' };

    await directoryAuth.signOutOfDirectory();

    expect(st.getItem('sb-fake-auth-token')).toBeNull();
  });

  it('sin error, el comportamiento normal de auth-js ya alcanza (no hace falta forzar dos veces)', async () => {
    const st = relaySession.supabaseAuthStorage();
    st.setItem('sb-fake-auth-token', 'lo-que-sea');
    signOutError = null;

    await directoryAuth.signOutOfDirectory();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('R3-2(b): logout y login quedan serializados', () => {
  it('un signOut LENTO no puede terminar después de un login que arranca mientras tanto', async () => {
    signOutDelayMs = 50;

    const logout = directoryAuth.signOutOfDirectory(); // fire-and-forget, como en authStore.signOut()
    const login = directoryAuth.signIntoDirectory('google', 'tok'); // arranca "mientras" el logout sigue en vuelo

    await Promise.all([logout, login]);

    expect(orden).toEqual(['signOut', 'signIn']); // nunca al revés
    expect(sesion).toEqual({ user: { is_anonymous: false } }); // la identidad quedó, no la pisó un logout tardío
  });

  it('al revés (login primero, logout encolado después) también respeta el orden de llegada', async () => {
    signInDelayMs = 30;

    const login = directoryAuth.signIntoDirectory('google', 'tok');
    const logout = directoryAuth.signOutOfDirectory();

    await Promise.all([login, logout]);

    expect(orden).toEqual(['signIn', 'signOut']);
  });
});
