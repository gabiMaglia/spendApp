/**
 * T-147 (SIMPLIFICACIÓN 2026-09-27, ENMENDADA por T-147-b 2026-09-27 ·
 * `engram/plans/T-147.md`, sellada por el PO) · sesión del buzón.
 *
 * La SIMPLIFICACIÓN original decía "sesión anónima para todos, sin
 * excepción". T-147-b la reemplaza EN ESTE PUNTO: el captcha (P-3 original)
 * vuelve a ser sólo para invitados, así que el buzón vuelve a tener DOS
 * caminos — `'identity'` para cuentas Google/Apple (lee la sesión que dejó
 * `signInWithIdToken` del login; nunca `signInAnonymously`, nunca captcha) y
 * `'anonymous'` para invitados (sin cambios: sesión anónima + captcha). La
 * RECONEXIÓN (Google silencioso / Apple interactivo / rechazo de otra
 * cuenta) vive SÓLO en `app/auth/verify.tsx` — este módulo, para cuentas,
 * sólo LEE.
 *
 * ⚠️ Configura credenciales de relay en `process.env` y las borra en el
 * `afterAll` — si quedaran puestas, otro suite del mismo worker levanta el
 * motor de relectura con su `setInterval` y Jest no termina nunca.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let sesion: { user: { is_anonymous?: boolean; id?: string } } | null = null;
let errorDeGetSession: { message: string } | null = null;
let opciones: { auth?: Record<string, unknown> } = {};

const signInAnonymously = jest.fn(async () => {
  sesion = { user: { is_anonymous: true } };
  return { data: { session: sesion }, error: null as null | { message: string } };
});
const signOut = jest.fn(async () => ({ error: null }));
const startAutoRefresh = jest.fn();
const stopAutoRefresh = jest.fn();
const mockCliente = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: sesion }, error: errorDeGetSession })),
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
const mockRequestCaptchaToken = jest.fn(async () => mockCaptcha);

/**
 * T-147 (fix "no se pudo confirmar tu acceso"): sustituto de prueba del
 * puente real — permite simular, desde el test, que el widget de Turnstile
 * avisó "interactivo" sin levantar React ni WebView.
 */
let mockInteractiveListeners: Array<(activo: boolean) => void> = [];
const mockOnCaptchaInteractiveChange = jest.fn((cb: (activo: boolean) => void) => {
  mockInteractiveListeners.push(cb);
  return () => { mockInteractiveListeners = mockInteractiveListeners.filter(l => l !== cb); };
});
function emitirCaptchaInteractivo(activo: boolean) {
  mockInteractiveListeners.forEach(l => l(activo));
}

jest.mock('../captchaBridge', () => ({
  requestCaptchaToken: mockRequestCaptchaToken,
  onCaptchaInteractiveChange: mockOnCaptchaInteractiveChange,
}));

/**
 * No se reemplaza el módulo `react-native` entero: alcanza con espiar
 * `AppState.addEventListener` para capturar el callback.
 */
let appStateCb: (s: string) => void = () => {};

let S: typeof import('../relaySession');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  sesion = null;
  errorDeGetSession = null;
  mockCaptcha = { status: 'not_required' };
  signInAnonymously.mockClear();
  signOut.mockClear();
  startAutoRefresh.mockClear();
  stopAutoRefresh.mockClear();
  mockRequestCaptchaToken.mockClear();
  mockRequestCaptchaToken.mockImplementation(async () => mockCaptcha);
  mockOnCaptchaInteractiveChange.mockClear();
  mockInteractiveListeners = [];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateCb = cb;
    return { remove: jest.fn() };
  }) as typeof RN.AppState.addEventListener);

  S = require('../relaySession');
  S.__resetRelaySession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;
  // Todos los tests de este archivo (salvo el describe de T-147-b de abajo)
  // hablan del camino de INVITADO — default explícito para no depender del
  // estado inicial del store.
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as never });
});

describe('el cliente persiste la sesión', () => {
  it('createClient con persistSession y storage propio', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const relay = require('../relay') as typeof import('../relay');
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
  it('con sesión anónima guardada la reusa (no abre otra)', async () => {
    sesion = { user: { is_anonymous: true } };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('sin sesión abre la anónima con el token del captcha', async () => {
    mockCaptcha = { status: 'ok', token: 'tok' };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'tok' } });
  });

  it('sin site key configurada, abre anónima sin captcha', async () => {
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

  /**
   * T-147 (fix "Reintentar no funciona" — systematic-debugging, evidencia de
   * campo del PO): el botón "Reintentar" de `verify.tsx` llamaba de nuevo a
   * `ensureRelaySession(true)`, pero `SESSION_RETRY_MS` (120s) seguía
   * bloqueando en silencio cualquier intento nuevo dentro de esa ventana —
   * el botón parecía no hacer nada. Ese cooldown frena al REINTENTO DE FONDO
   * (poll de `relayEngine`), no a una acción explícita de la persona:
   * `{ ignorarCooldown: true }` es la vía para que un Reintentar tocado a
   * mano nunca se coma en silencio.
   */
  it('Reintentar explícito ({ ignorarCooldown: true }) no respeta SESSION_RETRY_MS', async () => {
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockCaptcha = { status: 'ok', token: 'tok' };
    signInAnonymously.mockResolvedValueOnce({ data: { session: null } as never, error: { message: 'rate limit' } });
    expect(await S.ensureRelaySession()).toBe('none'); // primer intento falla, arma el cooldown

    // Sin avanzar el reloj (seguimos dentro de SESSION_RETRY_MS): un
    // ensureRelaySession() normal seguiría cayendo a 'none'...
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);

    // ...pero el Reintentar EXPLÍCITO de la persona sí vuelve a intentar.
    expect(await S.ensureRelaySession(true, { ignorarCooldown: true })).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
    ahora.mockRestore();
  });

  it('dos llamadas concurrentes abren UNA sola sesión', async () => {
    await Promise.all([S.ensureRelaySession(), S.ensureRelaySession()]);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  /**
   * BUG (T-147 post-merge): el cartel de captcha aparecía "en cualquier
   * momento" porque el reintento de fondo (poll de `relayEngine`) compartía
   * el mismo camino que la entrada real y podía terminar pidiendo un token
   * nuevo. `permitirCaptcha=false` es el freno: sin sesión, NUNCA intenta
   * abrir una (ni pide captcha, ni llama a `signInAnonymously`) — se resuelve
   * a 'none' en silencio, y el aviso `SinSesionDeSync` ya existente es quien
   * avisa en pantalla, no un modal.
   */
  it('permitirCaptcha=false: sin sesión, no intenta abrir ninguna (nunca pide captcha)', async () => {
    mockCaptcha = { status: 'ok', token: 'tok' }; // aunque el captcha resolvería bien...
    expect(await S.ensureRelaySession(false)).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('un error de getSession (refresh transitorio) NO abre sesión anónima', async () => {
    sesion = null;
    errorDeGetSession = { message: 'Failed to fetch' };
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('tras el error de getSession, respeta SESSION_RETRY_MS antes de reintentar', async () => {
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
    errorDeGetSession = { message: 'Failed to fetch' };
    expect(await S.ensureRelaySession()).toBe('none');
    errorDeGetSession = null; // la red volvió
    expect(await S.ensureRelaySession()).toBe('none'); // pero todavía no pasó el retry
    expect(signInAnonymously).not.toHaveBeenCalled();
    ahora.mockReturnValue(2_000_000 + S.SESSION_RETRY_MS + 1);
    expect(await S.ensureRelaySession()).toBe('anonymous');
    ahora.mockRestore();
  });

  it('sin sesión y SIN error (logout explícito, o primer arranque) sí abre anónima', async () => {
    sesion = null;
    errorDeGetSession = null;
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalled();
  });

  /**
   * Reinstalación / actualización de una versión con el diseño VIEJO de
   * T-147 (sesión de identidad persistida): con la simplificación, esa
   * sesión ya no sirve para nada — se purga y se abre una anónima limpia,
   * en vez de arrastrar un JWT de cuenta que el buzón nunca debe usar.
   */
  it('un residuo de sesión de IDENTIDAD en storage (diseño viejo) se purga y abre anónima', async () => {
    sesion = { user: { is_anonymous: false, id: 'uid-de-una-cuenta' } };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(signInAnonymously).toHaveBeenCalled();
  });
});

/**
 * T-147-b (`engram/plans/T-147.md`, sellado por el PO 2026-09-27): el
 * captcha vuelve a ser SÓLO para invitados. Una cuenta (Google/Apple) nunca
 * pasa por `signInAnonymously` ni por `requestCaptchaToken` — este módulo,
 * para cuentas, SÓLO lee la sesión que dejó `signInWithIdToken` en el login
 * (unificado con `directoryAuth.ts`, Task 2). La reconexión vive en
 * `verify.tsx` (Task 3), no acá.
 */
describe('T-147-b: sesión de CUENTA (Google/Apple) — sólo lee, nunca anónima ni captcha', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as never });
  });

  it('con sesión de cuenta ya persistida (no anónima) → identity, sin tocar signInAnonymously ni el captcha', async () => {
    sesion = { user: { is_anonymous: false, id: 'acc1' } };
    S.registrarDuenoDeSesionDeCuenta('acc1'); // T-175 (B2ii bis): confirma cuenta Y user.id 'acc1'
    expect(await S.ensureRelaySession(true)).toBe('identity');
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(mockRequestCaptchaToken).not.toHaveBeenCalled();
  });

  it('sin sesión → none, sin abrir ninguna ni pedir captcha (la reconexión no vive acá)', async () => {
    sesion = null;
    mockCaptcha = { status: 'ok', token: 'tok-que-nunca-debería-pedirse' };
    expect(await S.ensureRelaySession(true)).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(mockRequestCaptchaToken).not.toHaveBeenCalled();
  });

  it('con una sesión ANÓNIMA residual (invitado→cuenta a medio terminar) → none, no la confunde con identity', async () => {
    sesion = { user: { is_anonymous: true } };
    expect(await S.ensureRelaySession(true)).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('permitirCaptcha no importa para una cuenta: false también lee identity si ya hay sesión', async () => {
    sesion = { user: { is_anonymous: false, id: 'acc1' } };
    S.registrarDuenoDeSesionDeCuenta('acc1'); // T-175 (B2ii bis): confirma cuenta Y user.id 'acc1'
    expect(await S.ensureRelaySession(false)).toBe('identity');
  });

  it('un error de getSession (refresh transitorio) → none, nunca abre nada', async () => {
    errorDeGetSession = { message: 'Failed to fetch' };
    expect(await S.ensureRelaySession(true)).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});

/**
 * T-147 (fila 9c/9e de la retro): chequeo PURO — sin abrir nada, sin
 * captcha, sin purgar residuos — para que la hidratación inicial pueda
 * decidir si hace falta bloquear el paso a tabs con la pantalla de
 * verificación (9c) o si ya hay sesión y no hace falta mostrar nada (9e).
 */
describe('haySesionAnonimaValida', () => {
  it('con sesión anónima guardada, true — y no toca signInAnonymously', async () => {
    sesion = { user: { is_anonymous: true } };
    expect(await S.haySesionAnonimaValida()).toBe(true);
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('sin sesión, false', async () => {
    sesion = null;
    expect(await S.haySesionAnonimaValida()).toBe(false);
  });

  it('con sesión de IDENTIDAD (residuo del diseño viejo, no anónima), false — no la purga, sólo mira', async () => {
    sesion = { user: { is_anonymous: false, id: 'uid-de-una-cuenta' } };
    expect(await S.haySesionAnonimaValida()).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('error de getSession (refresh transitorio): false — prefiere mostrar la verificación de más antes que saltarla', async () => {
    sesion = null;
    errorDeGetSession = { message: 'Failed to fetch' };
    expect(await S.haySesionAnonimaValida()).toBe(false);
  });

  /**
   * T-147-b, fila 11 («arranque en frío con sesión persistida — cuenta o
   * invitado — sin pantalla»): para una CUENTA, "válida" es lo contrario que
   * para un invitado — acá SÍ hay identidad, y una anónima residual NO
   * cuenta.
   */
  describe('para una CUENTA (fila 11)', () => {
    beforeEach(() => {
      useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as never });
    });

    it('con sesión de cuenta persistida (no anónima), true — arranque en frío sin pantalla', async () => {
      sesion = { user: { is_anonymous: false, id: 'acc1' } };
      expect(await S.haySesionAnonimaValida()).toBe(true);
    });

    it('con una sesión ANÓNIMA residual, false — no sirve para una cuenta', async () => {
      sesion = { user: { is_anonymous: true } };
      expect(await S.haySesionAnonimaValida()).toBe(false);
    });

    it('sin sesión, false', async () => {
      sesion = null;
      expect(await S.haySesionAnonimaValida()).toBe(false);
    });
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

  it('arranca el auto-refresh también en frío, sin esperar ningún evento', () => {
    S.bindAuthRefreshToAppState();
    expect(startAutoRefresh).toHaveBeenCalled();
  });
});

describe('D2 (ronda 2): tope de tiempo, nunca cuelga', () => {
  it('si signInAnonymously nunca resuelve, ensureRelaySession vence a SESSION_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    signInAnonymously.mockImplementationOnce(() => new Promise(() => {})); // se cuelga

    const p = S.ensureRelaySession();
    await jest.advanceTimersByTimeAsync(S.SESSION_TIMEOUT_MS + 1);

    expect(await p).toBe('none');
    jest.useRealTimers();
  });

  it('vencido el tope, una llamada siguiente puede volver a intentar (no queda el single-flight pegado)', async () => {
    jest.useFakeTimers();
    signInAnonymously.mockImplementationOnce(() => new Promise(() => {}));
    const primera = S.ensureRelaySession();
    await jest.advanceTimersByTimeAsync(S.SESSION_TIMEOUT_MS + 1);
    expect(await primera).toBe('none');

    signInAnonymously.mockClear();
    await S.ensureRelaySession();
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

/**
 * T-147 (fix "no se pudo confirmar tu acceso" — evidencia de campo del PO,
 * causa raíz confirmada con systematic-debugging): `SESSION_TIMEOUT_MS`
 * envolvía TODO, incluida la espera humana del captcha interactivo. Con la
 * casilla fuera de vista (había que scrollear), la persona tardaba más de
 * 20s → `'none'` → `verify_failed`, aunque el captcha se hubiera resuelto
 * bien igual. El tope de red ahora se PAUSA mientras `CaptchaHost` avisa
 * "interactivo" (la persona decide cuánto tarda, con su propio aviso
 * "atascado" + Reintentar) y sigue aplicando de lleno a todo lo demás.
 */
describe('T-147: el tope de red se pausa mientras el captcha está interactivo', () => {
  it('captcha interactivo resuelto a los 45s simulados → sesión anonymous (no cae a los 20s)', async () => {
    jest.useFakeTimers();
    let resolverCaptcha: ((v: import('../captchaBridge').CaptchaOutcome) => void) | null = null;
    mockRequestCaptchaToken.mockImplementationOnce(() => new Promise(resolve => { resolverCaptcha = resolve; }));

    const p = S.ensureRelaySession();
    // deja correr los awaits previos (getSession) hasta que se pida el captcha
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockOnCaptchaInteractiveChange).toHaveBeenCalled();

    emitirCaptchaInteractivo(true); // Cloudflare pidió interacción: se pausa el tope

    await jest.advanceTimersByTimeAsync(45_000); // muy por encima de SESSION_TIMEOUT_MS
    expect(resolverCaptcha).not.toBeNull();

    resolverCaptcha!({ status: 'ok', token: 'tok-tarde' });
    emitirCaptchaInteractivo(false);
    await jest.advanceTimersByTimeAsync(0);

    expect(await p).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'tok-tarde' } });
    jest.useRealTimers();
  });

  it('sin pasar nunca por interactivo, la red colgada sigue cayendo a none a los 20s', async () => {
    jest.useFakeTimers();
    mockCaptcha = { status: 'ok', token: 'tok' };
    signInAnonymously.mockImplementationOnce(() => new Promise(() => {})); // se cuelga

    const p = S.ensureRelaySession();
    await jest.advanceTimersByTimeAsync(S.SESSION_TIMEOUT_MS + 1);

    expect(await p).toBe('none');
    jest.useRealTimers();
  });
});

/**
 * T-147 (punto 4 de la simplificación): cambio de cuenta / logout fuerza el
 * cierre de la sesión anónima y su storage — la próxima `ensureRelaySession`
 * abre una nueva.
 */
describe('reabrirSesionAnonima', () => {
  it('cierra la sesión local y borra el storage, aunque no haya sesión (invitado a cuenta ya sin residuo)', async () => {
    sesion = null;
    await S.reabrirSesionAnonima();
    // Sin cliente/sesión no hace falta llamar signOut de red: alcanza con que
    // el storage quede vacío para que la próxima lectura abra una nueva.
    expect(sesion).toBeNull();
  });

  it('con una sesión anónima guardada, la cierra de verdad (signOut local)', async () => {
    sesion = { user: { is_anonymous: true } };
    await S.reabrirSesionAnonima();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('tras reabrirSesionAnonima, ensureRelaySession abre una sesión NUEVA (no reusa nada)', async () => {
    sesion = { user: { is_anonymous: true } };
    await S.reabrirSesionAnonima();
    sesion = null; // lo que queda tras el signOut local, fiel a auth-js real

    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalled();
  });

  it('serializa con ensureRelaySession: un ensure en vuelo no se pisa con el reinicio', async () => {
    const orden: string[] = [];
    let liberar: (() => void) | null = null;
    signInAnonymously.mockImplementationOnce(() => new Promise(resolve => {
      liberar = () => {
        orden.push('ensure-resuelto');
        sesion = { user: { is_anonymous: true } };
        resolve({ data: { session: sesion }, error: null });
      };
    }));

    const ensurePromise = S.ensureRelaySession(); // arranca, se cuelga en signInAnonymously
    await new Promise(r => setTimeout(r, 0)); // deja correr los awaits previos (getSession, captcha)
    const reinicioPromise = S.reabrirSesionAnonima().then(() => orden.push('reinicio-resuelto'));

    liberar!();
    await ensurePromise;
    await reinicioPromise;

    expect(orden).toEqual(['ensure-resuelto', 'reinicio-resuelto']);
  });
});
