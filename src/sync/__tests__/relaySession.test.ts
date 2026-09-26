/**
 * T-147 (D1/D2/H2) · sesión de Supabase siempre presente.
 *
 * ⚠️ Configura credenciales de relay en `process.env` y las borra en el
 * `afterAll` — igual que `relayPrenda.test.ts`: si quedaran puestas, otro
 * suite del mismo worker levanta el motor de relectura con su `setInterval`
 * y Jest no termina nunca (pasó de verdad, 44 min).
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let sesion: { user: { is_anonymous?: boolean } } | null = null;
let opciones: { auth?: Record<string, unknown> } = {};
const signInAnonymously = jest.fn(async () => ({ data: { session: { user: { is_anonymous: true } } }, error: null as null | { message: string } }));
const signOut = jest.fn(async () => ({ error: null }));
const startAutoRefresh = jest.fn();
const stopAutoRefresh = jest.fn();
const mockCliente = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: sesion }, error: null })),
    signInAnonymously,
    signOut,
    startAutoRefresh,
    stopAutoRefresh,
  },
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((_u: string, _k: string, o: typeof opciones) => { opciones = o; return mockCliente; }),
}));

let mockCaptcha: import('../captchaBridge').CaptchaOutcome = { status: 'not_required' };
jest.mock('../captchaBridge', () => ({ requestCaptchaToken: jest.fn(async () => mockCaptcha) }));

let appStateCb: (s: string) => void = () => {};
jest.mock('react-native', () => ({
  AppState: { addEventListener: (_: string, cb: (s: string) => void) => { appStateCb = cb; return { remove: jest.fn() }; } },
}));

let S: typeof import('../relaySession');
let relay: typeof import('../relay');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  sesion = null;
  mockCaptcha = { status: 'not_required' };
  signInAnonymously.mockClear();
  signOut.mockClear();
  startAutoRefresh.mockClear();
  stopAutoRefresh.mockClear();
  S = require('../relaySession');
  relay = require('../relay');
  S.__resetRelaySession();
});

describe('el cliente persiste la sesión', () => {
  it('createClient con persistSession y storage propio', () => {
    relay.getRelayClient();
    expect(opciones.auth).toMatchObject({ persistSession: true, detectSessionInUrl: false });
    expect(opciones.auth!.storage).toBeDefined();
  });

  it('el storage guarda, lee y borra', () => {
    const st = S.supabaseAuthStorage();
    st.setItem('k', 'v');
    expect(st.getItem('k')).toBe('v');
    st.removeItem('k');
    expect(st.getItem('k')).toBeNull();
  });
});

describe('ensureRelaySession', () => {
  it('Gherkin «reapertura»: con sesión Google guardada no abre otra', async () => {
    sesion = { user: { is_anonymous: false } };
    expect(await S.ensureRelaySession()).toBe('identity');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('con sesión anónima guardada la reusa', async () => {
    sesion = { user: { is_anonymous: true } };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('Gherkin «usuario viejo que actualiza»: sin sesión abre anónima con el token del captcha', async () => {
    mockCaptcha = { status: 'ok', token: 'tok' };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'tok' } });
  });

  it('sin site key configurada abre anónima sin captcha', async () => {
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledWith();
  });

  it('captcha fallido → none, sin pedir sesión', async () => {
    mockCaptcha = { status: 'failed', reason: 'timeout' };
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('tras un fallo respeta SESSION_RETRY_MS y después reintenta', async () => {
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    signInAnonymously.mockResolvedValueOnce({ data: { session: null } as never, error: { message: 'rate limit' } });
    expect(await S.ensureRelaySession()).toBe('none');
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    ahora.mockReturnValue(1_000_000 + S.SESSION_RETRY_MS + 1);
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
    ahora.mockRestore();
  });

  it('dos llamadas concurrentes abren UNA sola sesión', async () => {
    await Promise.all([S.ensureRelaySession(), S.ensureRelaySession()]);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });
});

describe('refresco atado al ciclo de vida', () => {
  it('active → start, background → stop', () => {
    S.bindAuthRefreshToAppState();
    appStateCb('active');
    expect(startAutoRefresh).toHaveBeenCalled();
    appStateCb('background');
    expect(stopAutoRefresh).toHaveBeenCalled();
  });
});

describe('logout (H2)', () => {
  it('cierra SÓLO la sesión de este aparato', async () => {
    const { signOutOfDirectory } = require('../directoryAuth');
    await signOutOfDirectory();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
