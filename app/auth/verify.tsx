import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { ensureRelaySession } from '@/src/sync/relaySession';
import { setUltimaSesionConocida } from '@/src/sync/sessionStatus';
import { useEntryGateStore } from '@/src/store/entryGateStore';

/**
 * T-147 (fila 9, decisión del PO 2026-09-27, `engram/plans/T-147.md`) ·
 * pantalla de verificación BLOQUEANTE en la entrada — la única puerta por la
 * que el captcha puede aparecer:
 *
 * (a) al tocar «Entrar como invitado», (b) justo después del login
 * Google/Apple, (c) la primera vez que abre la versión nueva un usuario que
 * ya estaba logueado sin sesión del buzón. `AuthGuard` (`app/_layout.tsx`)
 * es quien manda acá — vía `decidirNavegacionAuthGuard` — y sólo dejar
 * pasar a tabs cuando el gate (`entryGateStore`) diga 'lista'.
 *
 * **No dibuja el captcha ella misma**: `ensureRelaySession(true)` dispara el
 * mismo `CaptchaHost` global (montado una única vez en `_layout.tsx`) que ya
 * resuelve el WebView estable — esta pantalla sólo se ocupa de bloquear el
 * paso a tabs y de reaccionar al resultado (fila 9d: fallo → mensaje +
 * Reintentar EN esta pantalla; fila 9f: opción de seguir sin verificar).
 */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const marcarLista = useEntryGateStore(s => s.marcarLista);
  const [fallo, setFallo] = useState(false);
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    void intentar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function intentar(): Promise<void> {
    setFallo(false);
    setVerificando(true);
    const kind = await ensureRelaySession(true);
    setUltimaSesionConocida(kind);
    setVerificando(false);
    if (kind === 'anonymous') { marcarLista(); return; }
    // Fila 9d: sin red, widget atascado (agotó su propio reintento en
    // `CaptchaHost`) o token rechazado — todos terminan acá con el mismo
    // mensaje y el mismo botón; distinguir el motivo exacto no cambia la
    // acción que la persona tiene disponible.
    setFallo(true);
  }

  /** Fila 9f: nunca un modal suelto — el aviso discreto ya existente
   *  (`SinSesionDeSync`) es quien avisa después, con una acción para volver
   *  a verificar cuando quiera. */
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
        {verificando && !fallo && <ActivityIndicator style={styles.spinner} />}
      </View>
      {fallo && (
        <ButtonRack>
          <ActionButton label={t('captcha.retry')} action={() => void intentar()} variant="primary" full />
          <ActionButton label={t('captcha.skip')} action={seguirSinVerificar} variant="ghost" full />
        </ButtonRack>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between', padding: Spacing[4] },
  contenido: { flex: 1, justifyContent: 'center', gap: Spacing[2] },
  centrado: { textAlign: 'center' },
  spinner: { marginTop: Spacing[4] },
});
