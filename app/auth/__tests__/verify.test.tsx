/**
 * T-147 (fila 9d/9f de la retro, decisión del PO 2026-09-27; rediseño
 * posterior por evidencia de campo): la pantalla de verificación bloqueante.
 * Reutiliza `ensureRelaySession` (mismo camino que ya prueba
 * `relaySession.test.ts` — acá sólo se prueba CÓMO reacciona la pantalla al
 * resultado, no la sesión en sí). `TurnstileWidget` se mockea acá NO por su
 * propio comportamiento (`TurnstileWidget.test.tsx` ya lo cubre) sino porque,
 * sin `EXPO_PUBLIC_TURNSTILE_SITEKEY`, no renderiza nada de todos modos —
 * este archivo se queda enfocado en la reacción de la pantalla.
 */
const mockEnsureRelaySession = jest.fn();
jest.mock('@/src/sync/relaySession', () => ({
  ensureRelaySession: (p?: boolean, o?: { ignorarCooldown?: boolean }) => mockEnsureRelaySession(p, o),
}));

// `TurnstileWidget` (montado inline por esta pantalla) importa
// `react-native-webview`, que exige un módulo nativo inexistente en Jest —
// alcanza con un stub mínimo, ya que sin `EXPO_PUBLIC_TURNSTILE_SITEKEY` el
// widget no renderiza nada de todos modos (comportamiento propio cubierto
// por `TurnstileWidget.test.tsx`).
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (p: object) => <View testID="turnstile-webview" {...p} /> };
});

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import VerifyScreen from '../verify';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';
import { sinSesionDeSync, __resetSessionStatus } from '@/src/sync/sessionStatus';

beforeEach(() => {
  __resetEntryGate();
  __resetSessionStatus();
  mockEnsureRelaySession.mockReset();
});

it('camino feliz: sesión OK → marca el gate "lista", sin mostrar ningún error', async () => {
  mockEnsureRelaySession.mockResolvedValue('anonymous');
  const { queryByText } = render(<VerifyScreen />);
  await act(async () => {});

  expect(mockEnsureRelaySession).toHaveBeenCalledWith(true, { ignorarCooldown: false });
  expect(useEntryGateStore.getState().estado).toBe('lista');
  expect(queryByText('captcha.verify_failed')).toBeNull();
  expect(sinSesionDeSync()).toBe(false);
});

/**
 * Fila 9d: sin red al entrar (o cualquier otro motivo — captcha rechazado,
 * widget atascado que ya agotó su propio reintento) → mensaje claro y
 * "Reintentar" EN ESA PANTALLA, nunca un modal suelto ni un paso silencioso
 * a tabs.
 */
describe('fila 9d: falla al entrar → mensaje + Reintentar en la misma pantalla', () => {
  it('muestra el aviso de fallo y NO marca el gate como listo', async () => {
    mockEnsureRelaySession.mockResolvedValue('none');
    const { getByText } = render(<VerifyScreen />);
    await act(async () => {});

    expect(getByText('captcha.verify_failed')).toBeTruthy();
    expect(useEntryGateStore.getState().estado).not.toBe('lista'); // no deja pasar a tabs
  });

  it('"Reintentar" vuelve a pedir la sesión (ignorando el cooldown), y si ahora sale bien, marca el gate "lista"', async () => {
    mockEnsureRelaySession.mockResolvedValueOnce('none').mockResolvedValueOnce('anonymous');
    const { getByText } = render(<VerifyScreen />);
    await act(async () => {});
    expect(getByText('captcha.verify_failed')).toBeTruthy();
    expect(mockEnsureRelaySession).toHaveBeenNthCalledWith(1, true, { ignorarCooldown: false });

    await act(async () => { fireEvent.press(getByText('captcha.retry')); });

    expect(mockEnsureRelaySession).toHaveBeenCalledTimes(2);
    // Fix "Reintentar no funciona" (evidencia de campo del PO): un toque
    // explícito de Reintentar tiene que ignorar SESSION_RETRY_MS, o el botón
    // parece no hacer nada dentro de la ventana de cooldown.
    expect(mockEnsureRelaySession).toHaveBeenNthCalledWith(2, true, { ignorarCooldown: true });
    expect(useEntryGateStore.getState().estado).toBe('lista');
  });
});

/**
 * Fila 9f: elegir seguir sin verificar → nunca un modal suelto; el aviso
 * discreto ya existente («sin conexión al servidor de sync», `sessionStatus`)
 * es quien avisa, y el gate deja pasar a tabs igual.
 */
describe('fila 9f: seguir sin verificar', () => {
  it('marca el gate "lista" y deja el aviso discreto de sesión activado', async () => {
    mockEnsureRelaySession.mockResolvedValue('none');
    const { getByText } = render(<VerifyScreen />);
    await act(async () => {});
    expect(getByText('captcha.verify_failed')).toBeTruthy();

    await act(async () => { fireEvent.press(getByText('captcha.skip')); });

    expect(useEntryGateStore.getState().estado).toBe('lista');
    expect(sinSesionDeSync()).toBe(true);
  });
});
