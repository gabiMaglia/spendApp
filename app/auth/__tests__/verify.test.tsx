/**
 * T-147 (fila 9d/9f de la retro, decisión del PO 2026-09-27): la pantalla de
 * verificación bloqueante. Reutiliza `ensureRelaySession(true)` (mismo
 * camino que ya prueba `relaySession.test.ts` — acá sólo se prueba CÓMO
 * reacciona la pantalla al resultado, no la sesión en sí) y el `CaptchaHost`
 * global sigue siendo el único que muestra el WebView — esta pantalla no
 * duplica ningún JSX de captcha.
 */
const mockEnsureRelaySession = jest.fn();
jest.mock('@/src/sync/relaySession', () => ({ ensureRelaySession: (p?: boolean) => mockEnsureRelaySession(p) }));

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

  expect(mockEnsureRelaySession).toHaveBeenCalledWith(true);
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

  it('"Reintentar" vuelve a pedir la sesión, y si ahora sale bien, marca el gate "lista"', async () => {
    mockEnsureRelaySession.mockResolvedValueOnce('none').mockResolvedValueOnce('anonymous');
    const { getByText } = render(<VerifyScreen />);
    await act(async () => {});
    expect(getByText('captcha.verify_failed')).toBeTruthy();

    await act(async () => { fireEvent.press(getByText('captcha.retry')); });

    expect(mockEnsureRelaySession).toHaveBeenCalledTimes(2);
    expect(mockEnsureRelaySession).toHaveBeenNthCalledWith(2, true);
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
