/**
 * T-147-b (`engram/plans/T-147.md`, sellado por el PO 2026-09-27) · captcha
 * SÓLO para invitados — enmienda a la SIMPLIFICACIÓN del mismo día.
 *
 * Tabla de estados del handoff: un `it` por fila, contra el `GoTrueClient`
 * REAL de `@supabase/auth-js` (2.109.0, la misma versión instalada) — no un
 * mock de `signInAnonymously`/`signInWithIdToken`/`getSession` a mano. Sólo
 * se reemplaza el transporte HTTP (`fetch` fake, fiel al contrato de GoTrue)
 * y el bridge del captcha (nativo, no es parte de auth-js). El storage es un
 * Map en memoria por test — persiste entre llamadas DENTRO de un test (como
 * el storage cifrado real), y arranca vacío en cada uno (como una
 * reinstalación, salvo que el test siembre algo a propósito).
 *
 * **Filas de ESTE archivo (las que no dependen de la UI de reconexión):**
 * 1 (invitado nuevo), 2 (cuenta Google nueva), 3 (cuenta Apple nueva),
 * 7 (invitado → cuenta), 8 (cambio de cuenta A→B con cola), 11 (arranque en
 * frío con sesión persistida). Las filas 4/5/6 (reconexión silenciosa de
 * Google, botón "Volvé a iniciar sesión" de Apple, rechazo de otra cuenta)
 * dependen de `GoogleSignin`/`AppleAuthentication` — nativas, fuera del
 * contrato de `auth-js` — y viven en `accountEntry.test.ts` (Task 3). La 9
 * y la 10 (aviso con acción) viven en `SinSesionDeSync.test.tsx` (Task 4).
 *
 * **Alcance deliberado.** Las filas hablan de "sync OK" / "trabajos en
 * cola", pero lo que este archivo prueba es la parte que cambia con
 * T-147-b: la sesión del buzón (`relaySession.ts`, ahora con DOS caminos
 * según `authProvider`) y el reinicio por cambio de cuenta
 * (`relayEngine.reiniciarSyncPorCambioDeCuenta` + `relayQueue`). El resto
 * del motor (contactos, invitaciones, drenaje de grupos) no depende de qué
 * cuenta está activa — ya tiene su propia cobertura (`relayEngineSesion.
 * test.ts`, `anunciarMiTarjeta.test.ts`, `relayQueue.test.ts`) y mockearlo
 * acá sólo agregaría ruido sin probar nada nuevo. Por eso el "orden real"
 * que se reproduce es el de `src/store/session.ts:subscribeSessionRehydrate`
 * en la parte que le importa a esta tabla: `reiniciarSyncPorCambioDeCuenta()`
 * corre con el usuario YA cambiado (zustand entrega el estado nuevo a los
 * subscribers), y recién después arranca `startRelay()` (que es lo que
 * dispara `ensureRelaySession()`) — `cambiarCuenta()`, acá abajo, hace
 * exactamente esas dos llamadas, en ese orden, contra el código real.
 *
 * **011a/011b (nota del handoff).** El SQL de `fix/T-147-sql`
 * (`011b_relay_rls_corte.sql:82`, `revoke all on public.envelopes from anon,
 * authenticated`) confirma que 011b corta TAMBIÉN a `authenticated` del
 * acceso directo — el buzón pasa entero a las RPC `security definer`
 * (`fetch_since`/`publish_envelope`, ya con fallback en `relay.ts`). Lo que
 * hace que la sesión anónima (o de cuenta) siga sirviendo después de 011b es
 * que Supabase le da a CUALQUIER sesión firmada el rol de Postgres
 * `authenticated` en el JWT (el rol `anon` es sólo para pedidos SIN sesión,
 * con la anon key pelada). Este archivo no repite la cobertura de
 * RPC-con-fallback (`relayRpc.test.ts` ya la tiene).
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

import { GoTrueClient } from '@supabase/auth-js';

/** Storage en memoria, fiel al contrato async de auth-js. Vacío = "reinstalación". */
function storageEnMemoria() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => { m.set(k, v); },
    removeItem: async (k: string) => { m.delete(k); },
    _map: m,
  };
}

let storageBuzon = storageEnMemoria();
let uidSecuenciaAnon = 0;
let uidSecuenciaCuenta = 0;
let redCaida = false;
/** D1 (verifier, ronda 2): retraso artificial del login por id_token, para
 *  que una lectura de sesión que arranca DESPUÉS (pero sin esperar el login)
 *  tenga margen real de adelantársele si las dos colas no están unificadas. */
let retrasoTokenMs = 0;

/**
 * Fetch fake: responde como GoTrue para signup anónimo (invitado), login por
 * `id_token` (cuenta — Task 2: `directoryAuth.signIntoDirectory` corre
 * contra ESTE MISMO cliente ahora, unificado) y logout.
 */
async function fetchFalso(url: string | URL, opts?: { method?: string }): Promise<Response> {
  if (redCaida) throw new Error('network down');
  const u = url.toString();
  if (u.includes('/signup') && opts?.method === 'POST') {
    uidSecuenciaAnon++;
    const uid = `anon-${uidSecuenciaAnon}`;
    return new Response(JSON.stringify({
      access_token: `tok-${uid}`, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${uid}`,
      user: { id: uid, is_anonymous: true, aud: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] },
    }), { status: 200 });
  }
  if (u.includes('/token') && u.includes('grant_type=id_token') && opts?.method === 'POST') {
    if (retrasoTokenMs) await new Promise(r => setTimeout(r, retrasoTokenMs));
    uidSecuenciaCuenta++;
    const uid = `cuenta-${uidSecuenciaCuenta}`;
    return new Response(JSON.stringify({
      access_token: `tok-${uid}`, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${uid}`,
      user: { id: uid, is_anonymous: false, aud: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] },
    }), { status: 200 });
  }
  if (u.includes('/logout')) return new Response(null, { status: 204 });
  return new Response(JSON.stringify({ error: 'not_found', error_description: 'ruta no simulada' }), { status: 404 });
}

let mockClienteBuzon: GoTrueClient;

function nuevoClienteBuzon(): GoTrueClient {
  return new GoTrueClient({
    url: 'https://prueba.local/auth/v1',
    storage: storageBuzon,
    storageKey: 'sb-buzon-auth-token',
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: fetchFalso as any,
  });
}

jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  getRelayClient: () => ({ auth: mockClienteBuzon }),
  subscribeTopic: jest.fn(() => () => {}),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
  fetchSince: jest.fn(async () => ({ ok: true, envelopes: [], cursor: 0, more: false })),
  deleteMyEnvelopes: jest.fn(async () => ({ ok: true, deleted: 0 })),
  esFuncionAusente: () => false,
}));
jest.mock('../inviteEngine', () => ({
  activeInvites: () => [],
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));
jest.mock('../contactChannel', () => ({
  ensureContactSecret: () => null,
  deriveContactTopic: jest.fn(async () => 'topic-contactos'),
  drainContacts: jest.fn(async () => ({ cursor: 0, added: 0, joinedGroups: [], conflictedGroups: [] })),
  sendGroupKeyResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  announceCardResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));
jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));
jest.mock('../deviceKeys', () => ({ verifyMyKeyRegistered: jest.fn(async () => 'desconocido') }));

let mockCaptcha: import('../captchaBridge').CaptchaOutcome = { status: 'not_required' };
jest.mock('../captchaBridge', () => ({
  requestCaptchaToken: jest.fn(async () => mockCaptcha),
  // T-147 (fix "no se pudo confirmar tu acceso"): relaySession se suscribe
  // acá para pausar su tope de red durante el captcha interactivo — este
  // suite no ejercita ese camino, alcanza con un no-op que desuscribe.
  onCaptchaInteractiveChange: jest.fn(() => () => {}),
}));

let relaySession: typeof import('../relaySession');
let relayEngine: typeof import('../relayEngine');
let relayQueue: typeof import('../relayQueue');
let sessionStatus: typeof import('../sessionStatus');
let directoryAuth: typeof import('../directoryAuth');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  storageBuzon = storageEnMemoria();
  uidSecuenciaAnon = 0;
  uidSecuenciaCuenta = 0;
  redCaida = false;
  retrasoTokenMs = 0;
  mockCaptcha = { status: 'not_required' };
  mockClienteBuzon = nuevoClienteBuzon();

  relaySession = require('../relaySession');
  relayEngine = require('../relayEngine');
  relayQueue = require('../relayQueue');
  sessionStatus = require('../sessionStatus');
  directoryAuth = require('../directoryAuth');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;

  relaySession.__resetRelaySession();
  sessionStatus.__resetSessionStatus();
  relayQueue.__resetRelayQueue();
});

afterEach(() => {
  relayEngine.stopRelay();
});

const cuenta = (id = 'acc1', authProvider: 'google' | 'apple' = 'google'): { id: string; authProvider: 'google' | 'apple' } =>
  ({ id, authProvider });
const invitado = (id = 'g1'): { id: string; authProvider: 'guest' } => ({ id, authProvider: 'guest' });

/**
 * Reproduce el orden real de `subscribeSessionRehydrate`
 * (`src/store/session.ts:121-131`): el usuario activo YA cambió cuando
 * `reiniciarSyncPorCambioDeCuenta` corre, y recién DESPUÉS arranca
 * `startRelay()` (lo que hace `rehydrateForActiveUser`, sin el resto de la
 * rehidratación — ver el docblock de arriba).
 */
async function cambiarCuenta(next: { id: string } | null): Promise<void> {
  useAuthStore.setState({ currentUser: next as never });
  relayEngine.reiniciarSyncPorCambioDeCuenta();
  await relayEngine.startRelay(true); // entrada real: la ÚNICA que permite captcha (session.ts)
}

function uidGuardado(): string | null {
  const raw = storageBuzon._map.get('sb-buzon-auth-token');
  if (!raw) return null;
  return (JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null;
}

describe('fila 1 · invitado nuevo', () => {
  it('entra como invitado: abre anónima con captcha', async () => {
    mockCaptcha = { status: 'ok', token: 'tok-invitado' };
    await cambiarCuenta(invitado());
    expect(uidGuardado()).toMatch(/^anon-/);
  });

  it('segunda lectura: no vuelve a pedir captcha (la sesión ya está abierta)', async () => {
    useAuthStore.setState({ currentUser: invitado() as never });
    mockCaptcha = { status: 'ok', token: 'tok-1' };
    expect(await relaySession.ensureRelaySession(true)).toBe('anonymous');

    const { requestCaptchaToken } = require('../captchaBridge');
    (requestCaptchaToken as jest.Mock).mockClear();
    expect(await relaySession.ensureRelaySession(true)).toBe('anonymous');
    expect(requestCaptchaToken).not.toHaveBeenCalled();
  });
});

describe('fila 2 · cuenta Google nueva', () => {
  it('el login (signInWithIdToken) deja una sesión de CUENTA en el buzón, sin captcha', async () => {
    await cambiarCuenta(cuenta('acc-google', 'google'));
    // Recién arranca: sin login todavía, el buzón sólo LEE — nada que leer.
    expect(uidGuardado()).toBeNull();

    // El login llama a esto (`app/auth/index.tsx:entrarAlDirectorio`), con el
    // MISMO id_token que ya tiene del SDK de Google — unificado (Task 2) con
    // el cliente del buzón.
    const r = await directoryAuth.signIntoDirectory('google', 'idtok-de-prueba');
    expect(r).toEqual({ ok: true });

    expect(uidGuardado()).toMatch(/^cuenta-/); // JWT de CUENTA, nunca anon-
    expect(await relaySession.ensureRelaySession(true)).toBe('identity');

    const { requestCaptchaToken } = require('../captchaBridge');
    expect(requestCaptchaToken).not.toHaveBeenCalled();
  });
});

describe('fila 3 · cuenta Apple nueva', () => {
  it('ídem fila 2, con Apple', async () => {
    await cambiarCuenta(cuenta('acc-apple', 'apple'));
    const r = await directoryAuth.signIntoDirectory('apple', 'idtok-de-apple');
    expect(r).toEqual({ ok: true });

    expect(uidGuardado()).toMatch(/^cuenta-/);
    expect(await relaySession.ensureRelaySession(true)).toBe('identity');
  });

  /**
   * D1 (verifier, ronda 2 — rechazo bloqueante): orden REAL de
   * `app/auth/index.tsx:313-320` — `setUser` dispara el login
   * (`entrarAlDirectorio` → `signIntoDirectory`) SIN `await`, y casi en el
   * mismo instante `verify.tsx` (o el propio `startRelay`) llama a
   * `ensureRelaySession`. Antes de este fix, `relaySession` y
   * `directoryAuth` tenían colas SEPARADAS: la lectura no esperaba nada del
   * login en vuelo y leía 'none' antes de tiempo — «No se pudo confirmar tu
   * acceso» sobre un login que en realidad iba a salir bien. Con una sola
   * cola compartida, la lectura queda detrás del login encolado y espera.
   */
  it('D1: setUser → login SIN await → la lectura espera el login encolado y da "identity", nunca falla', async () => {
    useAuthStore.setState({ currentUser: cuenta('acc-apple', 'apple') as never });
    retrasoTokenMs = 15; // el login tarda un toque — tiempo de sobra para que una lectura sin cola compartida se le adelante

    const loginPromise = directoryAuth.signIntoDirectory('apple', 'idtok-de-apple'); // fire-and-forget, como en el login real

    const kind = await relaySession.ensureRelaySession(true); // la MISMA pantalla, leyendo "ya"

    expect(kind).toBe('identity'); // nunca 'none': tuvo que esperar detrás del login en la cola compartida
    await expect(loginPromise).resolves.toEqual({ ok: true });
  });
});

/**
 * D2 (verifier, ronda 2 — rechazo bloqueante): una cuenta que ACTUALIZA
 * desde el `main` actual (donde TODOS usaban sesión anónima, sin
 * excepción) tiene una sesión ANÓNIMA residual guardada en 'sbauth'. Antes
 * de este fix, `ensureRelaySession` para una cuenta devolvía 'none' SIN
 * borrarla — el fondo (`relayEngine.ts`) seguía usando esa sesión anónima
 * (`getRelayClient()` la sigue teniendo persistida) y mandaba el JWT
 * anónimo bajo el nombre de una cuenta, violando "cuenta: nunca anónima".
 */
describe('fila 4b · cuenta que ACTUALIZA con una sesión ANÓNIMA residual (D2)', () => {
  it('la purga (signOut local) y lee "none" — nunca la confunde con identity ni la deja viva', async () => {
    // Estado heredado del `main` actual: TODOS abrían anónima, incluida esta
    // instalación (antes de que el perfil local pasara a decir "google").
    useAuthStore.setState({ currentUser: invitado() as never });
    mockCaptcha = { status: 'ok', token: 'tok-viejo' };
    await relaySession.ensureRelaySession(true);
    const uidAnonimoResidual = uidGuardado();
    expect(uidAnonimoResidual).toMatch(/^anon-/);

    // La versión nueva llega: el perfil YA dice "google" (usuario que
    // actualiza) — pero nadie purgó el storage del buzón todavía, porque
    // esto NO pasa por `reiniciarSyncPorCambioDeCuenta` (no es un cambio de
    // cuenta en vivo, es simplemente la sesión vieja que quedó ahí).
    useAuthStore.setState({ currentUser: cuenta('acc-google') as never });
    relaySession.__resetRelaySession();

    const kind = await relaySession.ensureRelaySession(true);

    expect(kind).toBe('none'); // nunca 'identity': la anónima no prueba ninguna cuenta
    expect(uidGuardado()).toBeNull(); // y tampoco queda viva para que el fondo la siga usando
  });
});

describe('fila 7 · invitado → cuenta', () => {
  it('la sesión anónima del invitado se reemplaza por la de cuenta (JWT nuevo, nunca anon-)', async () => {
    mockCaptcha = { status: 'ok', token: 'tok-invitado' };
    await cambiarCuenta(invitado());
    const uidInvitado = uidGuardado();
    expect(uidInvitado).toMatch(/^anon-/);

    await cambiarCuenta(cuenta());
    // El reinicio (Task 5, sin cambios) purgó la anónima; sin login todavía
    // no hay sesión que leer — la reconexión vive en `verify.tsx` (Task 3).
    expect(uidGuardado()).toBeNull();
    expect(await relaySession.ensureRelaySession(true)).toBe('none');

    await directoryAuth.signIntoDirectory('google', 'idtok-de-prueba');
    const uidCuenta = uidGuardado();
    expect(uidCuenta).toMatch(/^cuenta-/);
    expect(uidCuenta).not.toBe(uidInvitado);
    expect(await relaySession.ensureRelaySession(true)).toBe('identity');
  });
});

describe('fila 8 · cambio de cuenta A→B con trabajos en cola', () => {
  it('nada de lo encolado por A sale después del cambio a B', async () => {
    await cambiarCuenta(cuenta('A'));

    let corrioTrabajoDeA = false;
    relayQueue.encolar({ prioridad: 'normal', ejecutar: async () => { corrioTrabajoDeA = true; return 'hecho'; } });

    await cambiarCuenta(cuenta('B'));

    // `vaciarCola` (dentro de `reiniciarSyncPorCambioDeCuenta`) limpia el
    // array Y el timer agendado (`clearTimeout`) — nada queda pendiente de
    // correr, así que alcanza con comprobar el estado, sin esperar ningún
    // tick real.
    expect(relayQueue.__colaLength()).toBe(0);
    expect(corrioTrabajoDeA).toBe(false);
  });
});

describe('fila 11 · arranque en frío con sesión persistida', () => {
  it('cuenta: con sesión de identidad ya guardada, ensureRelaySession la lee sin tocar nada', async () => {
    useAuthStore.setState({ currentUser: cuenta('acc-vieja') as never });
    await directoryAuth.signIntoDirectory('google', 'idtok-de-prueba'); // simula que el login YA pasó antes
    relaySession.__resetRelaySession();

    expect(await relaySession.haySesionAnonimaValida()).toBe(true); // "sin pantalla" (session.ts la usa así)
    expect(await relaySession.ensureRelaySession(true)).toBe('identity');
  });

  it('invitado: con sesión anónima ya guardada, sin pantalla', async () => {
    useAuthStore.setState({ currentUser: invitado() as never });
    mockCaptcha = { status: 'ok', token: 'tok-1' };
    await relaySession.ensureRelaySession(true); // simula que ya había abierto antes
    relaySession.__resetRelaySession();

    expect(await relaySession.haySesionAnonimaValida()).toBe(true);
  });
});

describe('invitado: sin red / captcha fallido', () => {
  it('avisa "sin sesión" y se recupera solo al volver la red', async () => {
    useAuthStore.setState({ currentUser: invitado() as never });
    mockCaptcha = { status: 'failed', reason: 'timeout' };

    const kind = await relaySession.ensureRelaySession(true); // entrada real (invitado)
    if (!relaySession.haySesionEnCurso()) sessionStatus.setUltimaSesionConocida(kind);

    expect(kind).toBe('none');
    expect(sessionStatus.sinSesionDeSync()).toBe(true);

    // La red vuelve: hay que esperar el backoff (SESSION_RETRY_MS) antes de
    // que se reintente — igual que en producción.
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + relaySession.SESSION_RETRY_MS + 1);
    mockCaptcha = { status: 'ok', token: 'tok-recuperado' };

    const kind2 = await relaySession.ensureRelaySession(true); // reintento manual desde la misma pantalla de entrada
    if (!relaySession.haySesionEnCurso()) sessionStatus.setUltimaSesionConocida(kind2);

    expect(kind2).toBe('anonymous');
    expect(sessionStatus.sinSesionDeSync()).toBe(false);
    ahora.mockRestore();
  });
});

describe('reinstalación', () => {
  it('storage vacío y sin usuario: no abre ninguna sesión hasta que el usuario elija algo', async () => {
    // D5 (heredado): sin `currentUser` —pantalla de login recién abierta,
    // antes de elegir Google/Apple/invitado— el gate vive en
    // `arrancarCadenaDeSync` (relayEngine), no en `ensureRelaySession`: abrir
    // una sesión (y su captcha) ahí interrumpiría el login sin necesidad.
    useAuthStore.setState({ currentUser: null });
    await relayEngine.startRelay();
    expect(uidGuardado()).toBeNull();

    // Recién al elegir invitado (o loguearse) abre la anónima — fila 1.
    mockCaptcha = { status: 'ok', token: 'tok' };
    await cambiarCuenta(invitado('g-reinstalado'));
    expect(uidGuardado()).toMatch(/^anon-/);
  });
});

describe('logout', () => {
  it('cuenta: borra la sesión del buzón; nada queda persistido', async () => {
    await cambiarCuenta(cuenta());
    await directoryAuth.signIntoDirectory('google', 'idtok-de-prueba');
    expect(uidGuardado()).not.toBeNull();

    await cambiarCuenta(null);

    expect(uidGuardado()).toBeNull();
  });

  it('invitado: borra la sesión del buzón; nada queda persistido', async () => {
    mockCaptcha = { status: 'ok', token: 'tok' };
    await cambiarCuenta(invitado());
    expect(uidGuardado()).not.toBeNull();

    await cambiarCuenta(null);

    expect(uidGuardado()).toBeNull();
  });
});
