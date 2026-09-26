import React from 'react';
import { Modal } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { CaptchaHost } from '../CaptchaHost';
import * as bridge from '@/src/sync/captchaBridge';

let ultimoOnMessage: ((e: { nativeEvent: { data: string } }) => void) | null = null;
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return {
    WebView: (p: { onMessage: typeof ultimoOnMessage }) => {
      ultimoOnMessage = p.onMessage;
      return <View testID="turnstile-webview" />;
    },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const ORIGINAL_SITEKEY = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY;
const ORIGINAL_HOSTNAME = process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;

beforeEach(() => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = 'site';
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = 'x.supabase.co';
  ultimoOnMessage = null;
});
afterAll(() => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = ORIGINAL_SITEKEY;
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = ORIGINAL_HOSTNAME;
});

function montar() {
  return render(<CaptchaHost />);
}

const enviar = (m: object) => act(() => { ultimoOnMessage!({ nativeEvent: { data: JSON.stringify(m) } }); });

it('sin host montado → failed/no_host', async () => {
  await expect(bridge.requestCaptchaToken()).resolves.toEqual({ status: 'failed', reason: 'no_host' });
});

it('token silencioso → ok, sin mostrar la hoja', async () => {
  const { queryByText } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'token', token: 'T1' });
  await expect(p).resolves.toEqual({ status: 'ok', token: 'T1' });
  expect(queryByText('captcha.title')).toBeNull();
});

it('si pide interacción muestra la hoja y no vence a los 15 s', async () => {
  jest.useFakeTimers();
  const { getByText } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });
  expect(getByText('captcha.title')).toBeTruthy();
  act(() => { jest.advanceTimersByTime(60_000); });
  await enviar({ type: 'token', token: 'T2' });
  await expect(p).resolves.toEqual({ status: 'ok', token: 'T2' });
  jest.useRealTimers();
});

it('silencio 15 s sin interacción → failed/timeout', async () => {
  jest.useFakeTimers();
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => { jest.advanceTimersByTime(15_001); });
  await expect(p).resolves.toEqual({ status: 'failed', reason: 'timeout' });
  jest.useRealTimers();
});

it('error del widget → failed/error', async () => {
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'error', code: '300030' });
  await expect(p).resolves.toEqual({ status: 'failed', reason: 'error' });
});

it('cerrar la hoja → failed/dismissed', async () => {
  const { getByText } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });
  await act(async () => { fireEvent.press(getByText('captcha.cancel')); });
  await expect(p).resolves.toEqual({ status: 'failed', reason: 'dismissed' });
});

/**
 * Verifier D5: el `Modal` de la hoja (Android) no tenía `onRequestClose` —
 * sin él, el botón atrás del sistema no hace NADA en Android (el modal se
 * queda ahí, sin forma de salir salvo el botón "Ahora no").
 */
it('el botón atrás de Android (onRequestClose) cierra como "Ahora no"', async () => {
  const { getByText, UNSAFE_getByType } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });
  expect(getByText('captcha.title')).toBeTruthy();
  const modal = UNSAFE_getByType(Modal);
  expect(typeof modal.props.onRequestClose).toBe('function');
  await act(async () => { modal.props.onRequestClose(); });
  await expect(p).resolves.toEqual({ status: 'failed', reason: 'dismissed' });
});

it('al desmontar deja de atender', async () => {
  const { unmount } = montar();
  unmount();
  await expect(bridge.requestCaptchaToken()).resolves.toEqual({ status: 'failed', reason: 'no_host' });
});
