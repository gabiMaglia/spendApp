import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { TurnstileWidget, CAPTCHA_INTERACTIVE_STUCK_MS } from '../TurnstileWidget';
import * as bridge from '@/src/sync/sesion/captchaBridge';

let mockUltimoOnMessage: ((e: { nativeEvent: { data: string } }) => void) | null = null;
let mockUltimoProps: { style?: unknown; scalesPageToFit?: boolean; originWhitelist?: string[] } | null = null;
let mockMontajes = 0;
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const { useEffect } = require('react');
  return {
    WebView: (p: { onMessage: typeof mockUltimoOnMessage; style: unknown; scalesPageToFit?: boolean }) => {
      mockUltimoOnMessage = p.onMessage;
      mockUltimoProps = p;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => { mockMontajes++; }, []);
      return <View testID="turnstile-webview" />;
    },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const mockRecordError = jest.fn();
jest.mock('@/src/services/errorLog', () => ({ recordError: (e: unknown) => mockRecordError(e) }));

const ORIGINAL_SITEKEY = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY;
const ORIGINAL_HOSTNAME = process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;

beforeEach(() => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = 'site';
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = 'x.supabase.co';
  mockUltimoOnMessage = null;
  mockUltimoProps = null;
  mockMontajes = 0;
  mockRecordError.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = ORIGINAL_SITEKEY;
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = ORIGINAL_HOSTNAME;
});

function montar() {
  return render(<TurnstileWidget />);
}

const enviar = (m: object) => act(() => { mockUltimoOnMessage!({ nativeEvent: { data: JSON.stringify(m) } }); });

function flatten(style: unknown) {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

it('sin host montado → failed/no_host', async () => {
  await expect(bridge.requestCaptchaToken()).resolves.toEqual({ status: 'failed', reason: 'no_host' });
});

it('token silencioso → ok, sin haber mostrado nada, y no queda nada montado', async () => {
  const { getByTestId, queryByTestId } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  // Antes de resolver (modo "esperando"): colapsado, invisible.
  const estilo = flatten(getByTestId('turnstile-container').props.style) as { opacity?: number };
  expect(estilo.opacity).toBe(0);

  await enviar({ type: 'token', token: 'T1' });
  await expect(p).resolves.toEqual({ status: 'ok', token: 'T1' });
  // Resuelto: vuelve a 'idle', no queda nada en el árbol.
  expect(queryByTestId('turnstile-container')).toBeNull();
});

it('si pide interacción se agranda y no vence a los 15 s', async () => {
  jest.useFakeTimers();
  const { getByTestId } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });
  const estilo = flatten(getByTestId('turnstile-container').props.style) as { opacity?: number };
  expect(estilo.opacity).not.toBe(0);
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

it('al desmontar deja de atender', async () => {
  const { unmount } = montar();
  unmount();
  await expect(bridge.requestCaptchaToken()).resolves.toEqual({ status: 'failed', reason: 'no_host' });
});

/**
 * T-147 (rediseño): Android hace zoom al contenido para "hacerlo caber" en
 * el viewport (`scalesPageToFit` default `true`) — con `size:'flexible'` eso
 * deformaba el widget a un tamaño gigante en vez de su tamaño natural.
 */
it('desactiva scalesPageToFit (Android) para no deformar el tamaño natural del widget', async () => {
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  expect(mockUltimoProps?.scalesPageToFit).toBe(false);
  await enviar({ type: 'token', token: 'T' });
  await p;
});

/**
 * iOS: `originWhitelist` por defecto (`http://*`, `https://*`) también filtra
 * los iframes, y Turnstile monta su desafío en `about:blank`/`about:srcdoc`
 * (requisito documentado por Cloudflare para WebView). Sin `about:` el
 * desafío nunca aparece y el invitado no puede entrar (rechazo de App Review
 * 2026-10-07, reproducido en simulador).
 */
it('permite about: en la lista de orígenes (iframe del desafío en iOS) sin abrir otros esquemas', async () => {
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  expect(mockUltimoProps?.originWhitelist).toEqual(['https://*', 'about:*']);
  await enviar({ type: 'token', token: 'T' });
  await p;
});

/**
 * Diagnóstico: cada callback de Turnstile queda anotado en `errorLog` (local,
 * sin red, sin datos sensibles) para que un futuro reporte pueda decir QUÉ
 * pasó.
 */
describe('diagnóstico: cada callback de Turnstile queda anotado (sin datos sensibles)', () => {
  it('token', async () => {
    montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'token', token: 'T-secreto' });
    await p;
    expect(mockRecordError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'captcha', fatal: false }));
    const mensajes = mockRecordError.mock.calls.map(([e]) => JSON.stringify(e));
    expect(mensajes.join(' ')).not.toContain('T-secreto'); // nunca el token
  });

  it('error', async () => {
    montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'error', code: '300030' });
    await p;
    expect(mockRecordError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'captcha', fatal: false }));
  });

  it('interactive', async () => {
    montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    expect(mockRecordError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'captcha', fatal: false }));
    await enviar({ type: 'token', token: 'T' });
    await p;
  });
});

/**
 * BUG (fila de la retro pedida por el orquestador): "widget no se ve / no
 * responde en N s → mensaje + Reintentar". Si Cloudflare ya pidió
 * interacción (`interactive`) pero nunca llega ni un `token` ni un `error`
 * ni un `expired` — el widget se ve pero no responde, o no llegó a
 * dibujarse — la persona no puede quedarse mirando la casilla vacía para
 * siempre: a los `CAPTCHA_INTERACTIVE_STUCK_MS` se muestra el aviso y un
 * "Reintentar" que recarga el WebView (remonta, a propósito) SIN resolver
 * la promesa — la verificación sigue en la MISMA pantalla.
 */
describe('BUG: widget atascado en modo interactivo → mensaje + Reintentar', () => {
  it('tras el tope sin respuesta, muestra el aviso y el botón Reintentar', async () => {
    jest.useFakeTimers();
    const { getByText } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });

    await act(async () => { jest.advanceTimersByTime(CAPTCHA_INTERACTIVE_STUCK_MS + 1); });

    expect(getByText('captcha.stuck')).toBeTruthy();
    expect(getByText('captcha.retry')).toBeTruthy();

    await enviar({ type: 'token', token: 'T-tarde' });
    await p;
    jest.useRealTimers();
  });

  it('Reintentar recarga el WebView (remonta) sin resolver la promesa todavía', async () => {
    jest.useFakeTimers();
    const { getByText } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    await act(async () => { jest.advanceTimersByTime(CAPTCHA_INTERACTIVE_STUCK_MS + 1); });

    let resuelto = false;
    void p.then(() => { resuelto = true; });

    await act(async () => { fireEvent.press(getByText('captcha.retry')); });
    expect(resuelto).toBe(false); // sigue esperando, en la misma pantalla
    expect(mockMontajes).toBe(2); // el WebView se recargó (remount a propósito)

    await enviar({ type: 'token', token: 'T-al-fin' });
    await expect(p).resolves.toEqual({ status: 'ok', token: 'T-al-fin' });
    jest.useRealTimers();
  });
});

/**
 * T-147 ajuste alto: en Android un desafío de Turnstile puede medir más que
 * la casilla fija original y se corta. El HTML informa su alto real; el
 * contenedor lo toma (con piso y techo), sin remontar el WebView.
 */
describe('alto dinámico según lo que informa el widget', () => {
  it('toma el alto informado por el widget', async () => {
    const { getByTestId } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    await enviar({ type: 'height', height: 250 });

    const estilo = flatten(getByTestId('turnstile-container').props.style) as { height?: number };
    expect(estilo.height).toBe(250);

    await enviar({ type: 'token', token: 'irrelevante' });
    await p;
  });

  it('nunca baja del piso mínimo (70)', async () => {
    const { getByTestId } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    await enviar({ type: 'height', height: 20 });

    const estilo = flatten(getByTestId('turnstile-container').props.style) as { height?: number };
    expect(estilo.height).toBe(70);

    await enviar({ type: 'token', token: 'irrelevante' });
    await p;
  });

  it('nunca supera el techo razonable', async () => {
    const { getByTestId } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    await enviar({ type: 'height', height: 550 });

    const estilo = flatten(getByTestId('turnstile-container').props.style) as { height?: number };
    expect(estilo.height).toBeLessThanOrEqual(400);

    await enviar({ type: 'token', token: 'irrelevante' });
    await p;
  });

  it('cambiar de alto no remonta el WebView', async () => {
    montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    expect(mockMontajes).toBe(1);

    await enviar({ type: 'height', height: 200 });
    await enviar({ type: 'height', height: 90 });
    expect(mockMontajes).toBe(1);

    await enviar({ type: 'token', token: 'irrelevante' });
    await p;
  });
});

/**
 * T-147 (fix "no se pudo confirmar tu acceso"): el widget avisa por el
 * puente cuándo entra y sale de modo interactivo, para que `relaySession`
 * pause su tope de red mientras la persona resuelve el desafío a su ritmo.
 */
describe('avisa por el puente cuándo entra/sale de interactivo', () => {
  it('interactivo=true al agrandarse, false al resolverse', async () => {
    const eventos: boolean[] = [];
    const off = bridge.onCaptchaInteractiveChange(activo => eventos.push(activo));

    montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    expect(eventos).toEqual([]);

    await enviar({ type: 'interactive' });
    expect(eventos).toEqual([true]);

    await enviar({ type: 'token', token: 'T' });
    await p;
    expect(eventos).toEqual([true, false]);
    off();
  });

  it('si se desmonta a mitad de un desafío interactivo, también avisa false', async () => {
    const eventos: boolean[] = [];
    const off = bridge.onCaptchaInteractiveChange(activo => eventos.push(activo));

    const { unmount } = montar();
    const p = bridge.requestCaptchaToken();
    await act(async () => {});
    await enviar({ type: 'interactive' });
    expect(eventos).toEqual([true]);

    unmount();
    expect(eventos).toEqual([true, false]);
    off();
    void p; // queda sin resolver a propósito: nadie la espera tras desmontar
  });
});
