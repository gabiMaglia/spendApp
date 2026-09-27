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

import type { User } from '@/src/types/models';
// `useAuthStore` se pide FRESCO en cada test (ver `beforeEach`), como `S` y
// `relay`: con `jest.resetModules()`, un `import` estático de arriba quedaría
// atado a una instancia del store DISTINTA de la que `relaySession.ts` lee
// puertas adentro después del reset — el `setState` de acá nunca lo vería.
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

let sesion: { user: { is_anonymous?: boolean; id?: string } } | null = null;
let errorDeGetSession: { message: string } | null = null;
let opciones: { auth?: Record<string, unknown> } = {};
/**
 * Verifier ronda 2 (D2-bis): `signInAnonymously` real (`auth-js`
 * `GoTrueClient.js:497-499`) hace `_saveSession` INCONDICIONAL — deja la
 * sesión escrita pase lo que pase, nunca "no hace nada". El mock viejo no lo
 * hacía, y por eso un test podía pasar por una razón que auth-js no
 * respetaría en la realidad. Éste sí escribe `sesion` al resolver, como el
 * real.
 */
const signInAnonymously = jest.fn(async () => {
  sesion = { user: { is_anonymous: true } };
  return { data: { session: sesion }, error: null as null | { message: string } };
});
/**
 * Verifier R3-1: fiel a auth-js — al resolver sin error, deja escrita la
 * sesión de identidad de manera incondicional (mismo patrón que
 * `signInAnonymously` de arriba).
 */
const signInWithIdToken = jest.fn(async (_args: { provider: string; token: string }) => {
  // El `uid` por defecto coincide con el `id` local usado en `conCuenta()`
  // (más abajo) — así los tests que NO están probando el mismatch de
  // R4-1(a) siguen viendo una identidad válida "de la misma cuenta".
  sesion = { user: { is_anonymous: false, id: 'uid-acc1' } };
  return { data: { session: sesion }, error: null as null | { message: string } };
});
const signOut = jest.fn(async () => ({ error: null }));
const startAutoRefresh = jest.fn();
const stopAutoRefresh = jest.fn();
const mockCliente = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: sesion }, error: errorDeGetSession })),
    signInAnonymously,
    signInWithIdToken,
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

/**
 * Verifier R3-1: reconexión de cuentas — la respuesta que el host (Google
 * silencioso / Apple interactivo) le daría a `relaySession`.
 */
let mockReconnect: import('../accountReconnectBridge').ReconnectOutcome = { status: 'not_available' };
const mockRequestReconnect = jest.fn(async (_provider: string, _mode: string) => mockReconnect);
jest.mock('../accountReconnectBridge', () => ({
  requestReconnect: (provider: string, mode: string) => mockRequestReconnect(provider, mode),
}));

/**
 * No se reemplaza el módulo `react-native` entero (como antes): esta versión
 * del suite importa `useAuthStore` (D2), que arrastra `expo-constants` →
 * `expo-modules-core`, que necesita el `Platform` REAL de RN. Alcanza con
 * espiar `AppState.addEventListener` para capturar el callback — y, como
 * `useAuthStore`, hay que pedirlo FRESCO en cada test (mismo motivo: con
 * `jest.resetModules()`, `relaySession.ts` importa una instancia de
 * `react-native` distinta de la que este archivo espió antes del reset).
 */
let appStateCb: (s: string) => void = () => {};

let S: typeof import('../relaySession');
let relay: typeof import('../relay');

const invitado = (): User => ({ id: 'g1', authProvider: 'guest' } as User);
const conCuenta = (proveedor: 'google' | 'apple' = 'google'): User => ({ id: 'acc1', authProvider: proveedor } as User);

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  sesion = null;
  errorDeGetSession = null;
  mockCaptcha = { status: 'not_required' };
  mockReconnect = { status: 'not_available' };
  signInAnonymously.mockClear();
  signInWithIdToken.mockClear();
  signOut.mockClear();
  startAutoRefresh.mockClear();
  stopAutoRefresh.mockClear();
  mockRequestReconnect.mockClear();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;
  // Default histórico de este suite: modo invitado, salvo que el test diga
  // otra cosa (los de "con cuenta" lo pisan explícitamente).
  useAuthStore.setState({ currentUser: invitado() });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateCb = cb;
    return { remove: jest.fn() };
  }) as typeof RN.AppState.addEventListener);

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
    useAuthStore.setState({ currentUser: conCuenta() });
    sesion = { user: { is_anonymous: false } };
    expect(await S.ensureRelaySession()).toBe('identity');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('con sesión anónima guardada la reusa (invitado)', async () => {
    sesion = { user: { is_anonymous: true } };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('Gherkin «usuario viejo que actualiza»: invitado sin sesión abre anónima con el token del captcha', async () => {
    mockCaptcha = { status: 'ok', token: 'tok' };
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'tok' } });
  });

  it('sin site key configurada, invitado abre anónima sin captcha', async () => {
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

  /**
   * Verifier D1: un refresh que falla por red (offline al volver del fondo,
   * o el servidor caído) devuelve `{ session: null, error }` SIN borrar el
   * refresh token del storage (`GoTrueClient.js:2486-2506`, auth-js 2.109.0).
   * Tratar eso como "no hay sesión" abriría una anónima ENCIMA de una cuenta
   * Google/Apple todavía válida. La regla: nunca reemplazar una sesión de
   * cuenta por una anónima por un error transitorio.
   */
  it('D1: un error de getSession (refresh transitorio) NO abre sesión anónima', async () => {
    sesion = null;
    errorDeGetSession = { message: 'Failed to fetch' };
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('D1: tras el error de getSession, respeta SESSION_RETRY_MS antes de reintentar', async () => {
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

  it('D1: sin sesión y SIN error (logout explícito, o primer arranque) sí abre anónima (invitado)', async () => {
    sesion = null;
    errorDeGetSession = null;
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalled();
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

  /**
   * Verifier D1: con `autoRefreshToken: false` en el cliente, el refresco
   * SÓLO lo dispara este binding — y sólo reaccionaba a un evento `change` de
   * `AppState`. En un arranque en frío la app ya está `active` desde antes de
   * que nada se suscriba, así que ese evento nunca llega y el refresco
   * automático no arrancaba nunca hasta el primer backgrund/foreground.
   */
  it('arranca el auto-refresh también en frío, sin esperar ningún evento', () => {
    S.bindAuthRefreshToAppState();
    expect(startAutoRefresh).toHaveBeenCalled();
  });
});

/**
 * Verifier D2-bis (ronda 2, ruling del orquestador): «cortar de raíz, no
 * parchear» — la sesión ANÓNIMA sólo existe para el modo invitado. Con
 * cuenta (Google/Apple), `hacerEnsure` NUNCA llama a `signInAnonymously`,
 * ni siquiera mientras el login todavía no terminó: no hay ninguna carrera
 * posible porque el camino que la generaba no se toma. `setUser` YA trae
 * `authProvider` puesto en el mismo llamado que dispara `startRelay`
 * (`app/auth/index.tsx:247`, antes de `entrarAlDirectorio:273`), así que este
 * chequeo alcanza sin reordenar nada en el login.
 */
describe('D2 (ruling): la anónima sólo existe para el invitado', () => {
  it('con usuario de cuenta y el login TODAVÍA sin terminar, nunca abre anónima', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    sesion = null; // signInWithIdToken no terminó (o ni empezó)
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('sin usuario activo (currentUser null), tampoco abre anónima', async () => {
    useAuthStore.setState({ currentUser: null });
    expect(await S.ensureRelaySession()).toBe('none');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('con usuario invitado, sí abre anónima', async () => {
    useAuthStore.setState({ currentUser: invitado() });
    expect(await S.ensureRelaySession()).toBe('anonymous');
    expect(signInAnonymously).toHaveBeenCalled();
  });

  /**
   * El orden real de `app/auth/index.tsx`: `setUser` (con `authProvider` ya
   * puesto) dispara `startRelay` ANTES de que `entrarAlDirectorio` llame a
   * `signInWithIdToken`. Con la anónima descartada de raíz para cuentas, el
   * orden deja de importar: la primera vuelta no hace nada (`none`, se avisa
   * "sin sesión"), y en cuanto el login persiste la sesión de cuenta —auth-js
   * la escribe siempre, `_saveSession` incondicional— la vuelta siguiente
   * (poll o el reinicio por cambio de sesión) la encuentra y usa `identity`.
   * `registerDeviceKey` nunca corre con un uid anónimo.
   */
  it('orden real del login: primera vuelta "none", la siguiente ya ve la identidad', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') }); // auth/index.tsx:247
    sesion = null; // entrarAlDirectorio (:273) todavía no llamó a signInWithIdToken
    expect(await S.ensureRelaySession()).toBe('none');

    sesion = { user: { is_anonymous: false } }; // signInWithIdToken terminó y auth-js persistió
    expect(await S.ensureRelaySession()).toBe('identity');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});

/**
 * Verifier D2-bis, hallazgo hostil (ronda 2): `await identityEnCurso` no
 * tenía tope — con la anónima descartada de raíz para cuentas, ESA espera ya
 * no existe, pero `getSession`/`signInAnonymously` (invitado) siguen siendo
 * llamadas de red reales, y el resto de `relayEngine` usa `withTimeout` en
 * cada punto donde algo podría colgarse (T-138-bis). `ensureRelaySession`
 * tiene que seguir esa misma regla: si la red nunca contesta, se resuelve a
 * `none` pasado el tope, nunca cuelga el sync entero (el single-flight
 * compartiría esa promesa colgada con cada `releerTodo`).
 */
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
 * Verifier R3-1 (ronda 3, ruling nuevo del orquestador): el ruling de la
 * ronda 2 («la anónima sólo existe para el invitado») dejaba a CUALQUIER
 * cuenta sin sesión de Supabase guardada en `'none'` para siempre — que es
 * el caso de TODO usuario Google/Apple que actualiza desde una versión que
 * corría con `persistSession: false` (`bc933a9:relay.ts:86`). Nunca abre
 * anónima (eso no cambia), pero ahora intenta RECONECTAR sola.
 */
describe('R3-1: una cuenta sin sesión guardada se reconecta (nunca anónima)', () => {
  it('Gherkin «usuario viejo que actualiza» (cuenta Google): reconecta en silencio', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    sesion = null; // versión anterior no persistía sesión — exactamente este caso
    mockReconnect = { status: 'ok', idToken: 'tok-silencioso' };

    expect(await S.ensureRelaySession()).toBe('identity');

    expect(mockRequestReconnect).toHaveBeenCalledWith('google', 'silent');
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'tok-silencioso' });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('Apple (sin reconexión silenciosa posible): "none", nunca anónima', async () => {
    useAuthStore.setState({ currentUser: conCuenta('apple') });
    sesion = null;
    mockReconnect = { status: 'not_available' };

    expect(await S.ensureRelaySession()).toBe('none');

    expect(mockRequestReconnect).toHaveBeenCalledWith('apple', 'silent');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('un fallo de reconexión respeta un backoff antes de reintentar', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    sesion = null;
    mockReconnect = { status: 'not_available' };
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(3_000_000);

    expect(await S.ensureRelaySession()).toBe('none');
    expect(await S.ensureRelaySession()).toBe('none');
    expect(mockRequestReconnect).toHaveBeenCalledTimes(1); // todavía no pasó el backoff

    mockReconnect = { status: 'ok', idToken: 'tok2' };
    ahora.mockReturnValue(3_000_000 + S.RECONNECT_RETRY_MS + 1);
    expect(await S.ensureRelaySession()).toBe('identity');
    expect(mockRequestReconnect).toHaveBeenCalledTimes(2);

    ahora.mockRestore();
  });

  /**
   * R3-1/R3-2: una sesión ANÓNIMA vieja en el storage (invitado que pasó a
   * cuenta y cuyo `signOut` local no llegó a borrarla, o cualquier residuo)
   * no puede servir para una cuenta — se descarta sin tocar el storage
   * directamente acá (eso lo resuelve `signOutOfDirectory`/R3-2) y se sigue
   * el camino normal de reconexión.
   */
  it('una sesión anónima vieja en storage NO sirve para una cuenta: se descarta y reconecta', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    sesion = { user: { is_anonymous: true } }; // residuo de cuando era invitado
    mockReconnect = { status: 'ok', idToken: 'tok3' };

    expect(await S.ensureRelaySession()).toBe('identity');
    expect(signInWithIdToken).toHaveBeenCalled();
  });
});

/**
 * Verifier R4-1 (ronda 4): la sesión de Supabase se ATA al usuario activo —
 * nunca se acepta como `identity` una sesión cuyo `uid` no coincida con el
 * que ya se sabía de `currentUser.id`.
 */
describe('R4-1: la sesión se ata al usuario de la app', () => {
  it('R4-1(c): un residuo anónimo para una cuenta se BORRA de verdad (signOut local), no sólo se ignora', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    sesion = { user: { is_anonymous: true } };
    mockReconnect = { status: 'not_available' };

    expect(await S.ensureRelaySession()).toBe('none');

    // No alcanza con "no usarla": tiene que haberse cerrado de verdad, para
    // que ningún otro consumidor del cliente real (`drainAll`, `publishNow`)
    // la siga viendo cargada.
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('R4-1(a): un uid distinto al ya vinculado para este usuario se rechaza (no "identity")', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') });
    // Primera sesión válida: se vincula 'uid-original' a este usuario.
    sesion = { user: { is_anonymous: false, id: 'uid-original' } };
    expect(await S.ensureRelaySession()).toBe('identity');

    // «Reconectar» (u otro camino) dejó en el storage la sesión de OTRA
    // cuenta de Google — mismo `currentUser`, `uid` distinto.
    sesion = { user: { is_anonymous: false, id: 'uid-de-otra-cuenta' } };
    signOut.mockClear();
    mockReconnect = { status: 'not_available' };

    expect(await S.ensureRelaySession()).toBe('none'); // NUNCA "identity" con el uid equivocado
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' }); // se cerró, no quedó pisando
  });

  it('validarIdentidadReconectada: acepta la primera vez, rechaza un uid distinto después', async () => {
    sesion = { user: { is_anonymous: false, id: 'uid-A' } };
    expect(await S.validarIdentidadReconectada('acc1')).toBe('ok');

    sesion = { user: { is_anonymous: false, id: 'uid-C' } }; // «Reconectar» trajo otra cuenta
    signOut.mockClear();
    expect(await S.validarIdentidadReconectada('acc1')).toBe('otra_cuenta');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('validarIdentidadReconectada: sin sesión (o anónima) devuelve sin_sesion', async () => {
    sesion = null;
    expect(await S.validarIdentidadReconectada('acc1')).toBe('sin_sesion');
  });

  /**
   * Verifier R4-1(b) (ronda 4, hueco declarado en la ronda 3 — «A→B con
   * signOut lento»): el PoC real del verificador mostraba `getSession()`
   * devolviendo la sesión de A mientras el `signOut` de A todavía estaba en
   * vuelo (auth-js 2.109 no tiene lock propio). Este test no confía en la
   * VALIDACIÓN de identidad (R4-1a/c, que es una red de seguridad) — prueba
   * la DEFENSA PRIMARIA: la cola (`encolarOperacionDeSesion`) hace que
   * `ensureRelaySession` ni siquiera INTENTE leer la sesión hasta que el
   * `signOut` en vuelo haya terminado. Orden real: `signOutOfDirectory` (A)
   * se dispara, se cuelga a mitad de camino; recién ahí la app pasa a B y
   * pide una lectura de sesión — el orden de resolución observado tiene que
   * ser signOut-primero, getSession-después, nunca al revés.
   */
  it('R4-1(b): A→B con signOut lento — ensureRelaySession no lee la sesión hasta que el signOut en vuelo termina', async () => {
    useAuthStore.setState({ currentUser: conCuenta('google') }); // todavía A
    sesion = { user: { is_anonymous: false, id: 'uid-A' } };

    const orden: string[] = [];
    let liberarSignOut: (() => void) | null = null;
    signOut.mockImplementationOnce(() => new Promise(resolve => {
      liberarSignOut = () => { orden.push('signOut-resuelto'); resolve({ error: null }); };
    }));
    mockCliente.auth.getSession.mockImplementationOnce(async () => {
      orden.push('getSession-leyo');
      return { data: { session: sesion }, error: errorDeGetSession };
    });

    const { signOutOfDirectory } = require('../directoryAuth') as typeof import('../directoryAuth');
    const logoutDeA = signOutOfDirectory(); // A se desloguea — el signOut queda colgado

    // La app ya cambió el usuario activo a B mientras el signOut de A sigue
    // en vuelo, y dispara una lectura de sesión (el primer poll tras entrar).
    useAuthStore.setState({ currentUser: { id: 'accB', authProvider: 'google' } as User });
    const lecturaDeB = S.ensureRelaySession();

    // Deja correr microtasks: sin la cola, `getSession` ya habría corrido
    // acá, ANTES de que el signOut de A termine.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(orden).toEqual([]); // nada leyó todavía — la lectura de B está esperando en la cola

    sesion = { user: { is_anonymous: false, id: 'uid-B' } }; // lo que el login de B ya persistió
    liberarSignOut!();
    await logoutDeA;

    expect(await lecturaDeB).toBe('identity');
    expect(orden).toEqual(['signOut-resuelto', 'getSession-leyo']); // orden real: A termina antes de que B lea
  });
});

describe('logout (H2)', () => {
  it('cierra SÓLO la sesión de este aparato', async () => {
    const { signOutOfDirectory } = require('../directoryAuth');
    await signOutOfDirectory();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
