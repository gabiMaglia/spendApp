import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import {
  registerCaptchaProvider,
  setCaptchaInteractive,
  type CaptchaOutcome,
} from '@/src/sync/sesion/captchaBridge';
import { turnstileHtml, parseTurnstileMessage } from '@/src/sync/sesion/turnstileHtml';
import { recordError } from '@/src/services/errorLog';

/** Sin respuesta en este tiempo y SIN que Cloudflare haya pedido interacción,
 *  se da por fallado — un widget colgado no puede trabar el sync para siempre. */
export const CAPTCHA_SILENT_TIMEOUT_MS = 15_000;

/**
 * BUG (retro pedida por el orquestador tras la evidencia de campo del PO):
 * "widget no se ve / no responde en N s → mensaje + Reintentar". Una vez que
 * Cloudflare pidió interacción, la persona ya no tiene ningún reloj corriendo
 * (a propósito: se le deja el tiempo que necesite) — pero si el widget nunca
 * llega a dibujarse o a responder, quedarse mirando la casilla vacía para
 * siempre es peor que avisar y ofrecer recargarlo.
 */
export const CAPTCHA_INTERACTIVE_STUCK_MS = 25_000;

type Estado = 'idle' | 'esperando' | 'interactivo';

/** Piso y techo del alto dinámico: en Android un desafío de Turnstile puede
 *  medir más que la casilla original (~300×65). El widget informa su alto
 *  real por `postMessage`; acá se acota — nunca por debajo del alto original
 *  ni por encima de un techo razonable de la pantalla. */
const CAPTCHA_ALTO_MIN = 70;
const CAPTCHA_ALTO_MAX = 400;

/**
 * Widget de Cloudflare Turnstile (T-147, rediseño tras evidencia de campo del
 * PO): reemplaza al viejo `CaptchaHost` global montado en `_layout` con panel
 * inferior. Ese panel tenía dos problemas de raíz — el contenido podía medir
 * más que la casilla visible (imposible scrollear hasta ella) y vivía como
 * una capa flotante encima de TODO. Ahora este componente se monta INLINE,
 * únicamente dentro de `app/auth/verify.tsx` — la única pantalla donde el
 * captcha puede aparecer — a ancho completo y alto automático, sin overlay.
 *
 * Corre en modo Managed + `appearance: 'interaction-only'`: la mayoría de las
 * veces resuelve solo, sin mostrar nada (queda colapsado a 1×1, invisible).
 * Sólo cuando Cloudflare pide interacción se agranda a su alto real.
 *
 * Como sólo `verify.tsx` lo monta, `captchaBridge` sólo tiene provider
 * mientras esa pantalla está activa — el resto de la app (sync de fondo)
 * nunca puede pedir un captcha, ya lo garantizaba `permitirCaptcha=false`.
 */
export function TurnstileWidget() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [estado, setEstado] = useState<Estado>('idle');
  const [atascado, setAtascado] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [alto, setAlto] = useState(CAPTCHA_ALTO_MIN);
  const resolverRef = useRef<((r: CaptchaOutcome) => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atascadoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpiarAtascado = () => {
    if (atascadoTimeoutRef.current) { clearTimeout(atascadoTimeoutRef.current); atascadoTimeoutRef.current = null; }
  };

  /** Arranca (o reinicia) el tope de "widget atascado" — sólo corre en modo
   *  interactivo, nunca compite con `CAPTCHA_SILENT_TIMEOUT_MS`. */
  const armarAtascado = () => {
    limpiarAtascado();
    atascadoTimeoutRef.current = setTimeout(() => setAtascado(true), CAPTCHA_INTERACTIVE_STUCK_MS);
  };

  const limpiar = () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    limpiarAtascado();
    resolverRef.current = null;
    setAtascado(false);
    setEstado(actual => {
      if (actual === 'interactivo') setCaptchaInteractive(false);
      return 'idle';
    });
    setAlto(CAPTCHA_ALTO_MIN);
  };

  /** "Reintentar" del widget (fila de la retro): recarga SÓLO el WebView
   *  (remonta, a propósito) SIN resolver la promesa — la verificación sigue
   *  en la MISMA pantalla. Distinto del reintento de la pantalla entera
   *  (`verify.tsx`, que remonta este componente completo con una `key`
   *  nueva): éste es para "el desafío se ve pero no responde". */
  const reintentar = () => {
    setAtascado(false);
    setWebviewKey(k => k + 1);
    setAlto(CAPTCHA_ALTO_MIN);
    armarAtascado();
  };

  const resolver = (r: CaptchaOutcome) => {
    resolverRef.current?.(r);
    limpiar();
  };

  useEffect(() => {
    registerCaptchaProvider(() => new Promise<CaptchaOutcome>(resolve => {
      resolverRef.current = resolve;
      setEstado('esperando');
      timeoutRef.current = setTimeout(() => {
        // Sólo vence si Cloudflare no pidió interacción todavía: una vez que
        // se muestra el desafío, la persona decide cuánto tarda.
        setEstado(actual => {
          if (actual !== 'interactivo') resolver({ status: 'failed', reason: 'timeout' });
          return actual;
        });
      }, CAPTCHA_SILENT_TIMEOUT_MS);
    }));
    return () => {
      registerCaptchaProvider(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Si se desmonta a mitad de un desafío interactivo, avisa que dejó de
      // estarlo — nadie se queda esperando un aviso "false" que nunca llega.
      setCaptchaInteractive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY;
  const hostname = process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
  if (!siteKey) return null;

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parseTurnstileMessage(e.nativeEvent.data);
    if (!msg) return;
    // Diagnóstico local (sin red, sin datos sensibles — nunca el token):
    // sin poder ver el render real en el teléfono de quien reporta un bug,
    // esto deja registrado QUÉ callback disparó Turnstile.
    recordError({ message: `captcha:${msg.type}`, fatal: false, screen: 'captcha' });
    switch (msg.type) {
      case 'token':
        resolver({ status: 'ok', token: msg.token });
        return;
      case 'error':
        resolver({ status: 'failed', reason: 'error' });
        return;
      case 'interactive':
        // Deja de correr el reloj silencioso: a partir de acá la espera la
        // decide la persona. Avisa por el puente (para que `relaySession`
        // pause su propio tope de red) y arranca el tope de "atascado".
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        setEstado('interactivo');
        setCaptchaInteractive(true);
        armarAtascado();
        return;
      case 'expired':
        // El widget se re-arma solo; no hay nada que hacer desde acá.
        return;
      case 'height':
        setAlto(Math.min(CAPTCHA_ALTO_MAX, Math.max(CAPTCHA_ALTO_MIN, msg.height)));
        return;
    }
  };

  if (estado === 'idle') return null;

  const interactivo = estado === 'interactivo';

  /**
   * Una sola `View` raíz, montada siempre que `estado !== 'idle'` (nunca dos
   * ramas de `return` distintas): el `WebView` vive en la MISMA posición del
   * árbol durante toda la verificación, y sólo cambia el estilo del
   * CONTENEDOR (oculto ↔ visible); nunca se re-parenta ni se remonta salvo
   * que lo pida `reintentar()` (a propósito) o la pantalla entera (`key`
   * nueva en `verify.tsx`).
   */
  return (
    <View testID="turnstile-widget-root">
      <View
        testID="turnstile-container"
        style={interactivo ? [styles.contenedorVisible, { height: alto }] : styles.oculto}
      >
        <WebView
          key={webviewKey}
          testID="turnstile-webview"
          source={{ html: turnstileHtml(siteKey), baseUrl: hostname ? `https://${hostname}` : undefined }}
          onMessage={onMessage}
          // iOS filtra también los iframes con esta lista, y Turnstile monta
          // el desafío en `about:blank`/`about:srcdoc` (requisito de
          // Cloudflare para WebView). Con la lista por defecto el desafío
          // nunca aparecía y el invitado no podía entrar.
          originWhitelist={['https://*', 'about:*']}
          style={styles.webviewFill}
          javaScriptEnabled
          // Android por defecto hace zoom al contenido para "hacerlo caber"
          // en el viewport — con `size:'flexible'` eso deformaba el widget a
          // un tamaño gigante en vez de dejarlo a su tamaño natural.
          scalesPageToFit={false}
        />
      </View>
      {interactivo && atascado && (
        <>
          <Text style={[styles.aviso, { color: c.textSecondary }]}>{t('captcha.stuck')}</Text>
          <ButtonRack>
            <ActionButton label={t('captcha.retry')} action={reintentar} variant="secondary" full />
          </ButtonRack>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  oculto: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  // El WebView en sí NUNCA lleva `oculto`/`opacity:0` — es el contenedor de
  // arriba el que achica o agranda; así el propio `WebView` nunca cambia de
  // estilo entre estados, sólo el espacio que se le da.
  webviewFill: { flex: 1 },
  contenedorVisible: { width: '100%', marginVertical: Spacing[3] },
  aviso: { ...Typography.bodyM, marginBottom: Spacing[2] },
});
