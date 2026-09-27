/**
 * D3 (verifier, ronda 2, rechazo bloqueante): el plan (`engram/plans/T-147.md`)
 * exige "GoTrueClient real... afirmando el header Authorization de un
 * request real del buzón" — `deviceKeys.test.ts` comparaba un string que el
 * propio mock escribía (tautológico) y las filas 4/5/6 sólo mockeaban.
 *
 * Este archivo usa el `@supabase/supabase-js` REAL (no `../relay` mockeado):
 * `getRelayClient()` (`relay.ts`, sin tocar) construye un cliente de verdad,
 * con `fetch` global reemplazado por uno falso que responde como GoTrue
 * (signup anónimo, login por `id_token`) y como PostgREST (`rpc`) — y CAPTURA
 * el header `Authorization` de cada request RPC real, para poder afirmar con
 * qué JWT sale.
 *
 * `RealtimeClient` (que `SupabaseClient` arma en su constructor) exige un
 * `WebSocket` global — Node 20 no lo trae; se polyfillea con `ws` (ya está en
 * `node_modules`, como el `supabase-int` local del plan original ya
 * anticipaba). Sólo afecta este test: la app real corre en RN, que sí tiene
 * `WebSocket` nativo.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
(global as unknown as { WebSocket: unknown }).WebSocket = require('ws');

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let uidSecuenciaAnon = 0;
let uidSecuenciaCuenta = 0;
/** Header `Authorization` del último request RPC real del buzón. */
let ultimoAuthorizationRpc: string | null = null;

async function fetchFalso(input: unknown, init?: { method?: string; headers?: HeadersInit }): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);

  if (url.includes('/auth/v1/signup') && init?.method === 'POST') {
    uidSecuenciaAnon++;
    const uid = `anon-${uidSecuenciaAnon}`;
    return new Response(JSON.stringify({
      access_token: `tok-${uid}`, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${uid}`,
      user: { id: uid, is_anonymous: true, aud: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] },
    }), { status: 200 });
  }
  if (url.includes('/auth/v1/token') && url.includes('grant_type=id_token') && init?.method === 'POST') {
    uidSecuenciaCuenta++;
    const uid = `cuenta-${uidSecuenciaCuenta}`;
    return new Response(JSON.stringify({
      access_token: `tok-${uid}`, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${uid}`,
      user: { id: uid, is_anonymous: false, aud: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] },
    }), { status: 200 });
  }
  if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
  if (url.includes('/rest/v1/rpc/')) {
    ultimoAuthorizationRpc = headers.get('Authorization');
    return new Response(JSON.stringify([]), { status: 200 });
  }
  // `registerDeviceKey` (fire-and-forget dentro de `accountEntry.ts`) pega
  // un upsert a `/rest/v1/device_keys` — no es lo que este archivo prueba,
  // así que alcanza con no explotar.
  return new Response(JSON.stringify([]), { status: 200 });
}

(global as unknown as { fetch: unknown }).fetch = jest.fn(fetchFalso);

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signInSilently: jest.fn(),
    signIn: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { EMAIL: 'EMAIL' },
}));

let relay: typeof import('../relay');
let relaySession: typeof import('../relaySession');
let directoryAuth: typeof import('../directoryAuth');
let accountEntry: typeof import('../accountEntry');
let useAuthStore: typeof import('@/src/store/authStore').useAuthStore;

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  uidSecuenciaAnon = 0;
  uidSecuenciaCuenta = 0;
  ultimoAuthorizationRpc = null;
  ((global as unknown as { fetch: jest.Mock }).fetch as jest.Mock).mockClear?.();

  relay = require('../relay');
  relaySession = require('../relaySession');
  directoryAuth = require('../directoryAuth');
  accountEntry = require('../accountEntry');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useAuthStore = (require('@/src/store/authStore') as typeof import('@/src/store/authStore')).useAuthStore;

  relaySession.__resetRelaySession();
});

/**
 * D2 + D3 juntas: "el que actualiza" — sesión anónima residual del `main`
 * actual, currentUser YA dice 'google' (perfil migrado), reconexión
 * silenciosa, y el PRIMER request real del buzón después sale con el JWT de
 * cuenta — nunca con el anónimo de antes.
 */
it('cuenta Google que actualiza: la anónima residual se descarta, y fetch_since real sale con el JWT de cuenta', async () => {
  // 1. Storage con una sesión anónima real (como cualquier instalación del
  //    `main` actual, invitado o cuenta — ahí todos usaban anónima).
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as never });
  const primero = await relaySession.ensureRelaySession(true);
  expect(primero).toBe('anonymous');

  // 2. La versión nueva: el perfil local YA dice "google" (usuario que
  //    actualiza) — el `sub` coincide con `currentUser.id` para que `esYo`
  //    (T-048) lo acepte sin necesitar sembrar un alias.
  useAuthStore.setState({ currentUser: { id: 'sub-google-1', authProvider: 'google' } as never });
  relaySession.__resetRelaySession();

  const segundo = await relaySession.ensureRelaySession(true);
  expect(segundo).toBe('none'); // D2: la anónima residual nunca es 'identity' para una cuenta

  // 3. verify.tsx (modo cuenta, Google) reconecta SOLA — silencioso.
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  (GoogleSignin.signInSilently as jest.Mock).mockResolvedValue({
    type: 'success', data: { user: { id: 'sub-google-1' }, idToken: 'idtok-de-prueba' },
  });
  const reconexion = await accountEntry.reconectarGoogleSilencioso();
  expect(reconexion).toEqual({ status: 'ok' });

  relaySession.__resetRelaySession();
  const tercero = await relaySession.ensureRelaySession(true);
  expect(tercero).toBe('identity');

  // 4. Un request REAL del buzón (RPC `fetch_since`, vía `relay.ts` sin
  //    mockear) sale con el JWT de CUENTA — nunca con el anónimo de antes.
  const resultado = await relay.fetchSince('topic-de-prueba', 0);
  expect(resultado.ok).toBe(true);
  expect(ultimoAuthorizationRpc).toMatch(/^Bearer tok-cuenta-/);
  expect(ultimoAuthorizationRpc).not.toMatch(/^Bearer tok-anon-/);
});

/**
 * Fila 3 integrada (Apple, sin silencioso): reconexión vía el flujo
 * INTERACTIVO — mismo cliente, mismo request real, mismo chequeo de
 * Authorization.
 */
it('cuenta Apple: reconexión interactiva (sin silencioso) y el request real sale con el JWT de cuenta', async () => {
  useAuthStore.setState({ currentUser: { id: 'sub-apple-1', authProvider: 'apple' } as never });

  const primero = await relaySession.ensureRelaySession(true);
  expect(primero).toBe('none'); // sin sesión todavía — Apple no tiene silencioso

  const AppleAuthentication = require('expo-apple-authentication');
  (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
    user: 'sub-apple-1', identityToken: 'idtok-de-apple',
  });
  const reconexion = await accountEntry.reconectarInteractivo('apple');
  expect(reconexion).toEqual({ status: 'ok' });

  relaySession.__resetRelaySession();
  expect(await relaySession.ensureRelaySession(true)).toBe('identity');

  const resultado = await relay.fetchSince('topic-de-prueba', 0);
  expect(resultado.ok).toBe(true);
  expect(ultimoAuthorizationRpc).toMatch(/^Bearer tok-cuenta-/);

  // Y sigue firmando el directorio: `signIntoDirectory` pasó por
  // `directoryAuth.ts`, unificado con este mismo cliente (Task 2).
  expect(await directoryAuth.signOutOfDirectory()).toBeUndefined();
});
