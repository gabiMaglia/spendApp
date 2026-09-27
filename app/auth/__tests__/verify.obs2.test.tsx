/**
 * T-175 (obs 2, verifier T-147-b ronda 2, 2026-09-27): el single-flight
 * `if (enCurso) return enCurso` de `ensureRelaySession` puede devolverle a
 * `verify.tsx` una lectura ANTERIOR al login real, si `verify` lee en el
 * mismo tick en que ese login (disparado sin `await` desde
 * `app/auth/index.tsx`, `void entrarAlDirectorio(...)`) recién se está
 * encolando detrás de una lectura ya en vuelo (p.ej. el poll de fondo de
 * `relayEngine`).
 *
 * Reproducción con el camino REAL (no se mockea `relaySession` ni
 * `directoryAuth` — sólo el cliente de Supabase, el único borde de red):
 *  1. Una lectura #1 ya está en vuelo (`enCurso`) — simula el poll de fondo.
 *  2. Mientras #1 sigue sin resolver, se encola el LOGIN real (como hace
 *     `entrarAlDirectorio`, sin await) — queda detrás de #1 en la MISMA cola
 *     (fix D1).
 *  3. `verify.tsx` monta y llama a `ensureRelaySession` — como #1 sigue en
 *     vuelo, el single-flight le devuelve esa MISMA promesa (no una lectura
 *     propia, encolada detrás del login).
 *  4. #1 resuelve `'none'` (todavía no hay sesión) — pero el login sigue
 *     corriendo detrás en la cola.
 *  5. Sin el fix: `verify` se queda con ese `'none'` y muestra fallo aunque
 *     el login esté por salir bien. Con el fix: como la cola TODAVÍA tiene
 *     algo en vuelo cuando llega el `'none'`, `verify` relee — la relectura,
 *     sin `enCurso` propio, queda ENCOLADA detrás del login real y lo
 *     espera de verdad.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let sesion: { user: { is_anonymous?: boolean; id?: string } } | null = null;
let resolverGetSessionLenta: (() => void) | null = null;
let primerGetSessionUsado = false;

const getSession = jest.fn(async () => {
  // La PRIMERA lectura (simula el poll de fondo) se cuelga hasta que el
  // test decida liberarla — así el login real puede encolarse DETRÁS
  // mientras todavía está en vuelo.
  if (!primerGetSessionUsado) {
    primerGetSessionUsado = true;
    await new Promise<void>(resolve => { resolverGetSessionLenta = resolve; });
  }
  return { data: { session: sesion }, error: null };
});
const signInWithIdToken = jest.fn(async () => {
  sesion = { user: { is_anonymous: false, id: 'acc1' } }; // el login deja la sesión de identidad
  return { error: null };
});
const mockCliente = {
  auth: {
    getSession,
    signInWithIdToken,
    signOut: jest.fn(async () => ({ error: null })),
    signInAnonymously: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockCliente),
}));

// La reconexión de cuenta (Google silencioso / botón) no es lo que este test
// ejercita — se stubea para que no interfiera si el fix llegara tarde.
jest.mock('@/src/sync/accountEntry', () => ({
  reconectarGoogleSilencioso: jest.fn(async () => ({ status: 'failed', reason: 'no_credential' })),
  reconectarInteractivo: jest.fn(),
}));

// `TurnstileWidget` (montado inline por `verify.tsx` para invitados) importa
// `react-native-webview`, que exige un módulo nativo inexistente en Jest —
// mismo stub que usan `verify.test.tsx`/`verify.integration.test.tsx`. Este
// test es de modo CUENTA (nunca monta el widget), pero el módulo se importa
// igual al cargar `verify.tsx`.
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (p: object) => <View testID="turnstile-webview" {...p} /> };
});

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';
import type { User } from '@/src/types/models';

/**
 * `require` explícito, NO `import` estático (mismo patrón que
 * `verify.integration.test.tsx`): Babel adelanta TODOS los `import` de un
 * archivo por encima de cualquier otra sentencia, y `authStore.ts` importa
 * `isRelayConfigured` de `relay.ts` — un `import` estático acá arriba de
 * `useAuthStore` cargaría `relay.ts` ANTES de que las líneas de
 * `process.env` de más arriba corran, dejando `URL`/`ANON` en `undefined`
 * para siempre (closure de nivel de módulo).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VerifyScreen = (require('../verify') as typeof import('../verify')).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const relaySession = require('@/src/sync/relaySession') as typeof import('@/src/sync/relaySession');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const directoryAuth = require('@/src/sync/directoryAuth') as typeof import('@/src/sync/directoryAuth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require('@/src/store/authStore') as typeof import('@/src/store/authStore');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  __resetEntryGate();
  relaySession.__resetRelaySession();
  sesion = null;
  primerGetSessionUsado = false;
  resolverGetSessionLenta = null;
  getSession.mockClear();
  signInWithIdToken.mockClear();
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
});

const dejarCorrer = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

it('obs2: una lectura en vuelo que resuelve "none" antes que el login real (encolado detrás) no deja a verify colgado en el fallo — relee y llega a identity', async () => {
  // #1: lectura de fondo ya en vuelo (se cuelga en getSession, simulando el poll).
  const lecturaDeFondo = relaySession.ensureRelaySession(true);
  await dejarCorrer(); // deja que arranque y quede colgada en getSession

  // El login real se encola AHORA, detrás de #1 — igual que `entrarAlDirectorio`
  // disparado sin `await` justo después de `setUser` en `app/auth/index.tsx`.
  const login = directoryAuth.signIntoDirectory('google', 'tok-real');
  await dejarCorrer();

  // `verify.tsx` monta y pide su propia lectura — como #1 sigue en vuelo, el
  // single-flight le devuelve ESA MISMA promesa.
  const { queryByText } = render(<VerifyScreen />);
  await dejarCorrer();

  // Se libera #1: resuelve "none" (todavía no había sesión cuando arrancó).
  resolverGetSessionLenta!();
  await lecturaDeFondo;
  await login; // el login real ya terminó y dejó la sesión de identidad

  await dejarCorrer();
  await dejarCorrer();

  // Con el fix: verify no se quedó pegado al "none" viejo — releyó y encontró
  // la identidad que el login real (detrás en la cola) dejó lista.
  expect(useEntryGateStore.getState().estado).toBe('lista');
  expect(queryByText('captcha.verify_failed')).toBeNull();
});
