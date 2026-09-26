import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import { registerCaptchaProvider, type CaptchaOutcome } from '@/src/sync/captchaBridge';
import { turnstileHtml, parseTurnstileMessage } from '@/src/sync/turnstileHtml';

/** Sin respuesta en este tiempo y SIN que Cloudflare haya pedido interacción,
 *  se da por fallado — un widget colgado no puede trabar el sync para siempre. */
export const CAPTCHA_SILENT_TIMEOUT_MS = 15_000;

type Estado = 'idle' | 'esperando' | 'interactivo';

/**
 * Host visual del captcha (T-147 P-3): un WebView invisible que carga
 * Turnstile en modo Managed + `appearance: 'interaction-only'` — la mayoría de
 * las veces resuelve solo, sin mostrar nada. Sólo cuando Cloudflare pide
 * interacción se muestra una hoja mínima con el WebView adentro.
 *
 * Se monta UNA vez, en `_layout` (junto al `<Stack>`): registra el provider en
 * `captchaBridge` mientras vive, y lo desregistra al desmontarse — sin host,
 * `requestCaptchaToken()` devuelve `failed/no_host` en vez de colgarse
 * esperando a nadie.
 */
export function CaptchaHost() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [estado, setEstado] = useState<Estado>('idle');
  const resolverRef = useRef<((r: CaptchaOutcome) => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpiar = () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    resolverRef.current = null;
    setEstado('idle');
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
        // se muestra la hoja, la persona decide cuánto tarda.
        setEstado(actual => {
          if (actual !== 'interactivo') resolver({ status: 'failed', reason: 'timeout' });
          return actual;
        });
      }, CAPTCHA_SILENT_TIMEOUT_MS);
    }));
    return () => {
      registerCaptchaProvider(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY;
  const hostname = process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
  if (!siteKey) return null;

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parseTurnstileMessage(e.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'token':
        resolver({ status: 'ok', token: msg.token });
        return;
      case 'error':
        resolver({ status: 'failed', reason: 'error' });
        return;
      case 'interactive':
        // Deja de correr el reloj: a partir de acá la espera la decide la
        // persona (cerrar la hoja, o resolver el desafío visible).
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        setEstado('interactivo');
        return;
      case 'expired':
        // El widget se re-arma solo; no hay nada que hacer desde acá.
        return;
    }
  };

  if (estado === 'idle') return null;

  const webview = (
    <WebView
      testID="turnstile-webview"
      source={{ html: turnstileHtml(siteKey), baseUrl: hostname ? `https://${hostname}` : undefined }}
      onMessage={onMessage}
      style={styles.oculto}
      javaScriptEnabled
    />
  );

  if (estado === 'esperando') {
    // Invisible: 1×1, fuera de la vista, mientras Turnstile intenta resolver solo.
    return <View style={styles.oculto} pointerEvents="none">{webview}</View>;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Verifier D5: sin esto, el botón atrás de Android no hace NADA con el
      // modal abierto — la única salida quedaba en el botón "Ahora no". Se
      // trata igual que cerrar la hoja: `failed/dismissed`, nunca un error.
      onRequestClose={() => resolver({ status: 'failed', reason: 'dismissed' })}
    >
      <View style={[styles.velo, { backgroundColor: 'rgba(12, 16, 14, 0.5)' }]}>
        <View style={[styles.hoja, { backgroundColor: c.surface }]}>
          <Text style={[styles.titulo, { color: c.text }]}>{t('captcha.title')}</Text>
          <Text style={[styles.cuerpo, { color: c.textSecondary }]}>{t('captcha.body')}</Text>
          <View style={styles.webviewInteractivo}>{webview}</View>
          <ButtonRack>
            <ActionButton label={t('captcha.cancel')} action={() => resolver({ status: 'failed', reason: 'dismissed' })} variant="ghost" full />
          </ButtonRack>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  oculto: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  velo: { flex: 1, justifyContent: 'flex-end' },
  hoja: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, padding: Spacing[4] },
  titulo: { ...Typography.h3, marginBottom: Spacing[1] },
  cuerpo: { ...Typography.bodyM, marginBottom: Spacing[4] },
  webviewInteractivo: { height: 70, marginBottom: Spacing[3] },
});
