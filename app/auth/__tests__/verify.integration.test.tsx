/**
 * T-147 (fix "Reintentar no funciona" — reproducción de punta a punta pedida
 * por el orquestador, systematic-debugging + evidencia de campo del PO).
 *
 * A diferencia de `verify.test.tsx` (que mockea `ensureRelaySession` entero
 * para probar sólo la REACCIÓN de la pantalla), acá se deja correr el
 * camino REAL: `VerifyScreen` → `TurnstileWidget` → `captchaBridge` →
 * `relaySession` → `@supabase/supabase-js` (mockeado, es el único borde de
 * red). Esto es lo único que puede reproducir el bug real: el primer
 * intento falla, se aprieta "Reintentar", y sin este fix el botón "no hacía
 * nada" — `SESSION_RETRY_MS` (120s) se comía el segundo intento en
 * silencio, Y el widget de Turnstile (ya resuelto una vez) no iba a emitir
 * un token nuevo sin remontarse.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';
process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = 'site-de-prueba';
process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = 'x.supabase.co';

let sesion: { user: { is_anonymous?: boolean } } | null = null;
const signInAnonymously = jest.fn();
const mockCliente = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: sesion }, error: null })),
    signInAnonymously,
    signOut: jest.fn(async () => ({ error: null })),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockCliente),
}));

let mockUltimoOnMessage: ((e: { nativeEvent: { data: string } }) => void) | null = null;
let mockMontajesWebView = 0;
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const { useEffect } = require('react');
  return {
    WebView: (p: { onMessage: typeof mockUltimoOnMessage }) => {
      mockUltimoOnMessage = p.onMessage;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => { mockMontajesWebView++; }, []);
      return <View testID="turnstile-webview" />;
    },
  };
});

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';

/**
 * `require` explícito, NO `import` estático: Babel adelanta TODOS los
 * `import` de un archivo por encima de cualquier otra sentencia (semántica
 * ES de "los módulos se resuelven antes que nada"), así que un `import`
 * acá arriba correría ANTES de que las líneas de `process.env` de más
 * arriba se ejecuten — y `relay.ts` lee `EXPO_PUBLIC_SUPABASE_URL` en su
 * propio nivel de módulo, una sola vez. Mismo patrón que usa
 * `relaySession.test.ts` para el mismo problema.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VerifyScreen = (require('../verify') as typeof import('../verify')).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __resetRelaySession } = require('@/src/sync/relaySession') as typeof import('@/src/sync/relaySession');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY;
  delete process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
});

beforeEach(() => {
  __resetEntryGate();
  __resetRelaySession();
  sesion = null;
  signInAnonymously.mockReset();
  mockUltimoOnMessage = null;
  mockMontajesWebView = 0;
});

const enviarAlWidget = (m: object) => act(() => {
  mockUltimoOnMessage!({ nativeEvent: { data: JSON.stringify(m) } });
});

/** Deja correr toda la cadena de promesas encadenadas (cola.run → getSession
 *  → requestCaptchaToken → provider) hasta que el WebView efectivamente
 *  monte — un solo `act(async () => {})` no alcanza a vaciar varios saltos
 *  de microtasks encadenados. */
const dejarCorrer = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

it('primer intento falla, Reintentar remonta el widget y un token nuevo abre la sesión — SIN esperar el cooldown', async () => {
  // Primer intento: el captcha resuelve, pero el servidor de Auth rechaza
  // (rate limit / lo que sea) — arma `ultimoFallo` y su cooldown de 120s.
  signInAnonymously.mockResolvedValueOnce({ data: { session: null }, error: { message: 'rate limit' } });

  const { getByText } = render(<VerifyScreen />);
  await dejarCorrer(); // getSession() → requestCaptchaToken() → provider()

  expect(mockMontajesWebView).toBe(1);
  await enviarAlWidget({ type: 'token', token: 'tok-1' });
  await dejarCorrer();

  expect(getByText('captcha.verify_failed')).toBeTruthy();
  expect(signInAnonymously).toHaveBeenCalledTimes(1);

  // Segundo intento: token nuevo, esta vez el servidor acepta.
  signInAnonymously.mockResolvedValueOnce({ data: { session: { user: { is_anonymous: true } } }, error: null });

  fireEvent.press(getByText('captcha.retry'));
  await dejarCorrer();

  // El widget se remontó de verdad (WebView nueva instancia) — el desafío
  // de Turnstile es uno fresco, no el mismo ya resuelto/fallado de antes.
  expect(mockMontajesWebView).toBe(2);

  await enviarAlWidget({ type: 'token', token: 'tok-2' });
  await dejarCorrer();

  // Sin haber esperado nada (seguimos dentro de SESSION_RETRY_MS = 120s):
  // el Reintentar explícito no se comió el segundo intento en silencio.
  expect(signInAnonymously).toHaveBeenCalledTimes(2);
  expect(signInAnonymously).toHaveBeenNthCalledWith(2, { options: { captchaToken: 'tok-2' } });
  expect(useEntryGateStore.getState().estado).toBe('lista');
});
