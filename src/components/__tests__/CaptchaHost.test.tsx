import React from 'react';
import { BackHandler } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { CaptchaHost, CAPTCHA_INTERACTIVE_STUCK_MS } from '../CaptchaHost';
import * as bridge from '@/src/sync/captchaBridge';

let mockUltimoOnMessage: ((e: { nativeEvent: { data: string } }) => void) | null = null;
let mockUltimoStyle: unknown = null;
let mockMontajes = 0;
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const { useEffect } = require('react');
  return {
    WebView: (p: { onMessage: typeof mockUltimoOnMessage; style: unknown }) => {
      mockUltimoOnMessage = p.onMessage;
      mockUltimoStyle = p.style;
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
  mockUltimoStyle = null;
  mockMontajes = 0;
  mockRecordError.mockClear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY = ORIGINAL_SITEKEY;
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME = ORIGINAL_HOSTNAME;
});

function montar() {
  return render(<CaptchaHost />);
}

const enviar = (m: object) => act(() => { mockUltimoOnMessage!({ nativeEvent: { data: JSON.stringify(m) } }); });

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
 * Verifier D5: el botón atrás de Android tiene que cerrar la hoja como
 * "Ahora no" — sin esto no hay forma de salir salvo tocar el botón. Con el
 * `Modal` de RN se lograba con `onRequestClose`; al sacarlo (ver bug de
 * abajo) el mismo comportamiento pasa a un listener de `BackHandler` propio,
 * activo sólo mientras la hoja está interactiva.
 */
it('el botón atrás de Android cierra como "Ahora no"', async () => {
  const { getByText } = montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });
  expect(getByText('captcha.title')).toBeTruthy();

  const llamada = (BackHandler.addEventListener as jest.Mock).mock.calls
    .find(([evento]) => evento === 'hardwareBackPress');
  expect(llamada).toBeTruthy();
  await act(async () => { llamada![1](); });
  await expect(p).resolves.toEqual({ status: 'failed', reason: 'dismissed' });
});

/**
 * BUG (evidencia de campo del PO, Cloudflare Turnstile Analytics: 51
 * desafíos EMITIDOS, 0 resueltos, WebView Android): la hoja se veía en
 * blanco con sólo el botón "Ahora no" — el widget nunca se veía ni
 * respondía. Causa raíz confirmada leyendo el código: el `WebView` viajaba
 * SIEMPRE con `style={styles.oculto}` (1×1, `opacity: 0`), sin importar el
 * estado — el contenedor que lo envolvía cambiaba de tamaño, pero el
 * `WebView` de adentro seguía invisible e intocable.
 */
it('en estado interactivo, el WebView es visible (sin opacity:0 ni 1×1)', async () => {
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {});
  await enviar({ type: 'interactive' });

  const estilo = (Array.isArray(mockUltimoStyle) ? Object.assign({}, ...mockUltimoStyle.filter(Boolean)) : mockUltimoStyle) as {
    opacity?: number; width?: number; height?: number;
  };
  expect(estilo.opacity).not.toBe(0);
  expect(estilo.width === 1 && estilo.height === 1).toBe(false);
  await enviar({ type: 'token', token: 'irrelevante' });
  await p;
});

/**
 * BUG (misma evidencia de campo): además de invisible, el `WebView` cambiaba
 * de posición en el árbol al pasar de "esperando" (una `View` suelta) a
 * "interactivo" (adentro de un `Modal` nuevo) — React lo desmontaba y volvía
 * a montar, y Turnstile emitía un desafío NUEVO cada vez (coincide con los
 * 51 emitidos). El fix mantiene UNA sola instancia, en la misma posición del
 * árbol, durante toda la verificación.
 */
it('el WebView no se remonta al pasar de "esperando" a "interactivo"', async () => {
  montar();
  const p = bridge.requestCaptchaToken();
  await act(async () => {}); // estado 'esperando': ya montado una vez
  expect(mockMontajes).toBe(1);

  await enviar({ type: 'interactive' }); // pasa a 'interactivo'
  expect(mockMontajes).toBe(1); // misma instancia — no se desmontó ni se re-montó

  await enviar({ type: 'token', token: 'irrelevante' });
  await p;
});

it('al desmontar deja de atender', async () => {
  const { unmount } = montar();
  unmount();
  await expect(bridge.requestCaptchaToken()).resolves.toEqual({ status: 'failed', reason: 'no_host' });
});

/**
 * T-147 ajuste alto: en Android un desafío de Turnstile puede medir más que
 * la casilla fija de 70px y se corta. El HTML informa su alto real vía
 * `postMessage`; el contenedor lo toma (con piso y techo), sin remontar el
 * WebView — la instancia tiene que sobrevivir al cambio de alto igual que
 * sobrevive al paso 'esperando' → 'interactivo'.
 */
describe('alto dinámico según lo que informa el widget', () => {
  function flatten(style: unknown) {
    return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  }

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
 * Diagnóstico (pedido del orquestador tras la evidencia de campo): sin poder
 * ver el render real en el teléfono del PO, cada callback de Turnstile queda
 * anotado en `errorLog` (local, sin red, sin datos sensibles — sólo el tipo
 * de evento) para que un futuro reporte pueda decir QUÉ pasó.
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
 * dibujarse — la persona no puede quedarse mirando un botón "Ahora no" para
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
