/**
 * T-147 (SIMPLIFICACIÓN, retro obligatoria del PO — 2026-09-27).
 *
 * Tabla de estados del handoff: un `it` por fila, contra el `GoTrueClient`
 * REAL de `@supabase/auth-js` (2.109.0, la misma versión instalada) — no un
 * mock de `signInAnonymously`/`getSession` a mano. Sólo se reemplaza el
 * transporte HTTP (`fetch` fake, fiel al contrato de GoTrue) y el bridge del
 * captcha (nativo, no es parte de auth-js). El storage es un Map en memoria
 * por test — persiste entre llamadas DENTRO de un test (como el storage
 * cifrado real), y arranca vacío en cada uno (como una reinstalación, salvo
 * que el test siembre algo a propósito).
 *
 * **Alcance deliberado.** Las filas hablan de "sync OK" / "trabajos en
 * cola", pero lo que este archivo prueba es la parte que cambia con la
 * simplificación: la sesión ANÓNIMA del buzón (`relaySession.ts`) y el
 * reinicio por cambio de cuenta (`relayEngine.reiniciarSyncPorCambioDeCuenta`
 * + `relayQueue`). El resto del motor (contactos, invitaciones, drenaje de
 * grupos) no depende de qué cuenta está activa — ya tiene su propia
 * cobertura (`relayEngineSesion.test.ts`, `anunciarMiTarjeta.test.ts`,
 * `relayQueue.test.ts`) y mockearlo acá sólo agregaría ruido sin probar nada
 * nuevo. Por eso el "orden real" que se reproduce es el de
 * `src/store/session.ts:subscribeSessionRehydrate` en la parte que le
 * importa a esta tabla: `reiniciarSyncPorCambioDeCuenta()` corre con el
 * usuario YA cambiado (zustand entrega el estado nuevo a los subscribers),
 * y recién después arranca `startRelay()` (que es lo que dispara
 * `ensureRelaySession()`) — `cambiarCuenta()`, acá abajo, hace exactamente
 * esas dos llamadas, en ese orden, contra el código real.
 *
 * **011a/011b (nota del handoff).** El SQL de `fix/T-147-sql`
 * (`011b_relay_rls_corte.sql:82`, `revoke all on public.envelopes from anon,
 * authenticated`) confirma que 011b corta TAMBIÉN a `authenticated` del
 * acceso directo — el buzón pasa entero a las RPC `security definer`
 * (`fetch_since`/`publish_envelope`, ya con fallback en `relay.ts`). Lo que
 * hace que la sesión anónima siga sirviendo después de 011b es que Supabase
 * le da a CUALQUIER sesión firmada —anónima incluida— el rol de Postgres
 * `authenticated` en el JWT (el rol `anon` es sólo para pedidos SIN sesión,
 * con la anon key pelada). Por eso `ensureRelaySession` no necesita —ni
 * tiene— ninguna rama distinta para "antes/después de 011a/011b": abrir una
 * sesión anónima es SIEMPRE lo correcto, en las tres bases. Este archivo no
 * repite la cobertura de RPC-con-fallback (`relayRpc.test.ts` ya la tiene);
 * lo que documenta acá es por qué la sesión no necesita saber nada de eso.
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
let uidSecuencia = 0;
let redCaida = false;

/** Fetch fake: responde como GoTrue para signup (anónimo) y logout. Nada de
 *  Google/Apple acá — eso es `directoryAuth`, con su propio cliente. */
async function fetchFalso(url: string | URL, opts?: { method?: string }): Promise<Response> {
  if (redCaida) throw new Error('network down');
  const u = url.toString();
  if (u.includes('/signup') && opts?.method === 'POST') {
    uidSecuencia++;
    const uid = `anon-${uidSecuencia}`;
    return new Response(JSON.stringify({
      access_token: `tok-${uid}`, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${uid}`,
      user: { id: uid, is_anonymous: true, aud: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] },
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
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  storageBuzon = storageEnMemoria();
  uidSecuencia = 0;
  redCaida = false;
  mockCaptcha = { status: 'not_required' };
  mockClienteBuzon = nuevoClienteBuzon();

  relaySession = require('../relaySession');
  relayEngine = require('../relayEngine');
  relayQueue = require('../relayQueue');
  sessionStatus = require('../sessionStatus');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;

  relaySession.__resetRelaySession();
  sessionStatus.__resetSessionStatus();
  relayQueue.__resetRelayQueue();
});

afterEach(() => {
  relayEngine.stopRelay();
});

const cuenta = (id = 'acc1'): { id: string; authProvider: 'google' } => ({ id, authProvider: 'google' });
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

describe('fila 1 · actualiza (cuenta o invitado, sin sesión del buzón guardada)', () => {
  it('captcha una vez → anónima → sync OK', async () => {
    useAuthStore.setState({ currentUser: cuenta() as never }); // versión vieja: currentUser ya seteado, sin sesión del buzón
    mockCaptcha = { status: 'ok', token: 'tok-1' };

    expect(await relaySession.ensureRelaySession(true)).toBe('anonymous');
    expect(uidGuardado()).toMatch(/^anon-/);

    // Segunda lectura: NO vuelve a pedir captcha (la sesión ya está abierta).
    const { requestCaptchaToken } = require('../captchaBridge');
    (requestCaptchaToken as jest.Mock).mockClear();
    expect(await relaySession.ensureRelaySession(true)).toBe('anonymous');
    expect(requestCaptchaToken).not.toHaveBeenCalled();
  });
});

describe('fila 2 · cuenta nueva', () => {
  it('primer arranque de una cuenta recién creada: abre anónima y sincroniza', async () => {
    await cambiarCuenta(cuenta('acc-nueva'));
    expect(uidGuardado()).toMatch(/^anon-/);
    expect(sessionStatus.sinSesionDeSync()).toBe(false);
  });
});

describe('fila 3 · invitado nuevo', () => {
  it('entra como invitado: abre anónima con captcha', async () => {
    mockCaptcha = { status: 'ok', token: 'tok-invitado' };
    await cambiarCuenta(invitado());
    expect(uidGuardado()).toMatch(/^anon-/);
  });
});

describe('fila 4 · invitado → cuenta', () => {
  it('la sesión anónima del invitado se reemplaza por una nueva al pasar a cuenta', async () => {
    await cambiarCuenta(invitado());
    const uidInvitado = uidGuardado();
    expect(uidInvitado).not.toBeNull();

    await cambiarCuenta(cuenta());
    const uidCuenta = uidGuardado();

    expect(uidCuenta).not.toBeNull();
    expect(uidCuenta).not.toBe(uidInvitado); // sesión NUEVA, no la reusa
  });
});

describe('fila 5 · cambio de cuenta A→B con trabajos en cola', () => {
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

describe('fila 6 · logout', () => {
  it('borra la sesión del buzón; nada queda persistido', async () => {
    await cambiarCuenta(cuenta());
    expect(uidGuardado()).not.toBeNull();

    await cambiarCuenta(null);

    expect(uidGuardado()).toBeNull();
  });
});

describe('fila 7 · sin red / captcha fallido', () => {
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

describe('fila 8 · reinstalación', () => {
  it('storage vacío y sin usuario: no abre ninguna sesión hasta que el usuario elija algo', async () => {
    // D5 (heredado): sin `currentUser` —pantalla de login recién abierta,
    // antes de elegir Google/Apple/invitado— el gate vive en
    // `arrancarCadenaDeSync` (relayEngine), no en `ensureRelaySession`: abrir
    // una sesión (y su captcha) ahí interrumpiría el login sin necesidad.
    useAuthStore.setState({ currentUser: null });
    await relayEngine.startRelay();
    expect(uidGuardado()).toBeNull();

    // Recién al elegir invitado (o loguearse) abre la anónima — fila 3.
    await cambiarCuenta(invitado('g-reinstalado'));
    expect(uidGuardado()).toMatch(/^anon-/);
  });
});
