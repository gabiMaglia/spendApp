import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { TurnstileWidget } from '@/src/components/TurnstileWidget';
import { ensureRelaySession } from '@/src/sync/relaySession';
import { setUltimaSesionConocida } from '@/src/sync/sessionStatus';
import { useEntryGateStore } from '@/src/store/entryGateStore';

/**
 * T-147 (fila 9, decisión del PO 2026-09-27, `engram/plans/T-147.md`;
 * rediseño posterior por evidencia de campo) · pantalla de verificación
 * BLOQUEANTE en la entrada — la única puerta por la que el captcha puede
 * aparecer:
 *
 * (a) al tocar «Entrar como invitado», (b) justo después del login
 * Google/Apple, (c) la primera vez que abre la versión nueva un usuario que
 * ya estaba logueado sin sesión del buzón. `AuthGuard` (`app/_layout.tsx`)
 * es quien manda acá — vía `decidirNavegacionAuthGuard` — y sólo deja pasar
 * a tabs cuando el gate (`entryGateStore`) diga 'lista'.
 *
 * **Dibuja el captcha ella misma**, con `<TurnstileWidget />` INLINE (ya no
 * hay un `CaptchaHost` global con panel/velo — evidencia de campo del PO: el
 * desafío podía medir más que la casilla visible y era imposible scrollear
 * hasta ella). Como sólo esta pantalla lo monta, `ensureRelaySession` es la
 * ÚNICA que puede pedirle un captcha — el sync de fondo nunca tiene a quién.
 *
 * `key={intentoId}` fuerza un remonte COMPLETO del widget en cada
 * "Reintentar" explícito: un desafío ya resuelto (o fallado) de Turnstile no
 * emite un token nuevo sin que alguien lo reinicie, así que la única forma
 * confiable de garantizar un desafío fresco es recargar el WebView entero
 * (mismo mecanismo, a propósito, que el "Reintentar" INTERNO del widget para
 * "está atascado" — ver `TurnstileWidget.tsx`). El propio `ensureRelaySession`
 * recibe `{ ignorarCooldown: true }` en ese caso: `SESSION_RETRY_MS` existe
 * para frenar el reintento de FONDO, no un toque explícito de la persona.
 */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const marcarLista = useEntryGateStore(s => s.marcarLista);
  const [fallo, setFallo] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [intentoId, setIntentoId] = useState(0);

  useEffect(() => {
    void intentar(intentoId > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentoId]);

  async function intentar(esReintentoExplicito: boolean): Promise<void> {
    setFallo(false);
    setVerificando(true);
    const kind = await ensureRelaySession(true, { ignorarCooldown: esReintentoExplicito });
    setUltimaSesionConocida(kind);
    setVerificando(false);
    if (kind === 'anonymous') { marcarLista(); return; }
    // Fila 9d: sin red, widget atascado (agotó su propio reintento en
    // `TurnstileWidget`) o token rechazado — todos terminan acá con el mismo
    // mensaje y el mismo botón; distinguir el motivo exacto no cambia la
    // acción que la persona tiene disponible.
    setFallo(true);
  }

  /** "Reintentar" de la PANTALLA (distinto del interno del widget): remonta
   *  `TurnstileWidget` completo (nueva `key`) para garantizar un desafío de
   *  Turnstile fresco, e ignora el cooldown de `ensureRelaySession`. */
  function reintentar(): void {
    setIntentoId(id => id + 1);
  }

  /** Fila 9f: nunca un modal suelto — el aviso discreto ya existente
   *  (`SinSesionDeSync`) es quien avisa después, con una acción para volver
   *  a verificar cuando quiera. Visible SIEMPRE (no sólo tras un fallo): sin
   *  el "Ahora no" que tenía el viejo panel del widget, esta es la única
   *  salida mientras se espera un desafío interactivo. */
  function seguirSinVerificar(): void {
    setUltimaSesionConocida('none');
    marcarLista();
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.contenido}>
        <Text style={[Typography.h2, styles.centrado, { color: c.text }]}>
          {t('captcha.verify_title')}
        </Text>
        <Text style={[Typography.bodyM, styles.centrado, { color: c.textSecondary }]}>
          {fallo ? t('captcha.verify_failed') : t('captcha.verify_body')}
        </Text>
        <TurnstileWidget key={intentoId} />
        {verificando && !fallo && <ActivityIndicator style={styles.spinner} />}
      </View>
      <ButtonRack>
        {fallo && (
          <ActionButton label={t('captcha.retry')} action={reintentar} variant="primary" full />
        )}
        <ActionButton label={t('captcha.skip')} action={seguirSinVerificar} variant="ghost" full />
      </ButtonRack>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between', padding: Spacing[4] },
  contenido: { flex: 1, justifyContent: 'center', gap: Spacing[2] },
  centrado: { textAlign: 'center' },
  spinner: { marginTop: Spacing[4] },
});
