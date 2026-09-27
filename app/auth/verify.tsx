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
import { reconectarGoogleSilencioso, reconectarInteractivo } from '@/src/sync/accountEntry';
import { setUltimaSesionConocida } from '@/src/sync/sessionStatus';
import { useEntryGateStore } from '@/src/store/entryGateStore';
import { useAuthStore } from '@/src/store/authStore';

/**
 * T-147 (fila 9, decisión del PO 2026-09-27) · pantalla de verificación
 * BLOQUEANTE en la entrada — la única puerta por la que el buzón puede pedir
 * algo. `AuthGuard` (`app/_layout.tsx`) es quien manda acá — vía
 * `decidirNavegacionAuthGuard` — y sólo deja pasar a tabs cuando el gate
 * (`entryGateStore`) diga 'lista'.
 *
 * **T-147-b (`engram/plans/T-147.md`, sellado por el PO 2026-09-27):
 * captcha SÓLO para invitados.** Dos modos, en la MISMA pantalla:
 *
 *  - **Invitado:** sin cambios — `<TurnstileWidget />` INLINE (ya no hay un
 *    `CaptchaHost` global con panel/velo), `ensureRelaySession` abre una
 *    sesión ANÓNIMA con captcha. `key={intentoId}` fuerza un remonte
 *    COMPLETO del widget en cada "Reintentar": un desafío ya resuelto (o
 *    fallado) de Turnstile no emite un token nuevo sin que alguien lo
 *    reinicie.
 *  - **Cuenta (Google/Apple):** NUNCA capcha, NUNCA anónima —
 *    `ensureRelaySession` sólo LEE (`relaySession.ts`, Task 1). Si no hay
 *    sesión de cuenta todavía, esta pantalla reconecta
 *    (`accountEntry.ts`, Task 3): Google lo intenta SOLO (silencioso); Apple
 *    (o Google si el silencioso no alcanzó) muestra «Volvé a iniciar
 *    sesión», que corre el flujo interactivo del proveedor. Si esa
 *    reconexión trae OTRA cuenta (comparación de `sub` contra la identidad
 *    activa, con alias T-048), se rechaza con un mensaje — nada se guarda.
 *    Se descarta a propósito el Arbitraje P-2 (`accountReconnect`, botón
 *    «Reconectar», 17 estados): toda esta lógica vive acá y en
 *    `accountEntry.ts`, en un único lugar — el fondo (`relaySession.ts`)
 *    sólo lee la sesión que esta pantalla deja.
 */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const marcarLista = useEntryGateStore(s => s.marcarLista);
  const currentUser = useAuthStore(s => s.currentUser);
  const provider = currentUser?.authProvider;
  const modoCuenta = provider === 'google' || provider === 'apple';

  const [fallo, setFallo] = useState(false);
  const [otraCuenta, setOtraCuenta] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [intentoId, setIntentoId] = useState(0);

  useEffect(() => {
    if (modoCuenta) void intentarCuenta();
    else void intentarInvitado(intentoId > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentoId]);

  /** Invitado: sin cambios — anónima + captcha en `TurnstileWidget`. */
  async function intentarInvitado(esReintentoExplicito: boolean): Promise<void> {
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

  /**
   * Cuenta: primero LEE (puede que el login ya haya dejado la sesión — filas
   * 2/3, cuenta nueva). Si no hay nada todavía, Google intenta reconectar
   * SOLO (fila 4); Apple no tiene un silencioso equivalente, así que sólo
   * queda ofrecer el botón (fila 5).
   */
  async function intentarCuenta(): Promise<void> {
    setFallo(false);
    setOtraCuenta(false);
    setVerificando(true);

    let kind = await ensureRelaySession(true);
    if (kind !== 'identity' && provider === 'google') {
      const r = await reconectarGoogleSilencioso();
      if (r.status === 'ok') kind = await ensureRelaySession(true);
      // 'other_account' acá sería un residuo raro (el silencioso siempre
      // trae la MISMA cuenta que ya está logueada en el SDK) — cae igual al
      // botón interactivo de abajo, sin haber guardado nada.
    }

    setVerificando(false);
    setUltimaSesionConocida(kind);
    if (kind === 'identity') { marcarLista(); return; }
    setFallo(true);
  }

  /** Fila 5/6: botón «Volvé a iniciar sesión» — flujo INTERACTIVO del
   *  proveedor. Fila 6: si trae otra cuenta, rechazo con mensaje, nada
   *  guardado (ya lo garantiza `accountEntry.ts`). */
  async function reconectarConBoton(): Promise<void> {
    if (!provider || !modoCuenta) return;
    setFallo(false);
    setOtraCuenta(false);
    setVerificando(true);

    const r = await reconectarInteractivo(provider);
    if (r.status !== 'ok') {
      setVerificando(false);
      if (r.status === 'other_account') { setOtraCuenta(true); return; }
      setFallo(true);
      return;
    }

    const kind = await ensureRelaySession(true);
    setVerificando(false);
    setUltimaSesionConocida(kind);
    if (kind === 'identity') { marcarLista(); return; }
    setFallo(true);
  }

  /** "Reintentar" de la PANTALLA, sólo invitado (distinto del interno del
   *  widget): remonta `TurnstileWidget` completo (nueva `key`) para
   *  garantizar un desafío de Turnstile fresco, e ignora el cooldown de
   *  `ensureRelaySession`. */
  function reintentar(): void {
    setIntentoId(id => id + 1);
  }

  /** Fila 9f/10: nunca un modal suelto — el aviso discreto ya existente
   *  (`SinSesionDeSync`) es quien avisa después, con una acción para volver
   *  a verificar cuando quiera (Task 4). Visible SIEMPRE (no sólo tras un
   *  fallo): sin el "Ahora no" que tenía el viejo panel del widget de
   *  invitado, esta es la única salida mientras se espera un desafío
   *  interactivo o una reconexión. */
  function seguirSinVerificar(): void {
    setUltimaSesionConocida('none');
    marcarLista();
  }

  const cuerpo = otraCuenta ? t('captcha.other_account') : fallo ? t('captcha.verify_failed') : t('captcha.verify_body');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.contenido}>
        <Text style={[Typography.h2, styles.centrado, { color: c.text }]}>
          {t('captcha.verify_title')}
        </Text>
        <Text style={[Typography.bodyM, styles.centrado, { color: c.textSecondary }]}>
          {cuerpo}
        </Text>
        {!modoCuenta && <TurnstileWidget key={intentoId} />}
        {verificando && !fallo && !otraCuenta && <ActivityIndicator style={styles.spinner} />}
      </View>
      <ButtonRack>
        {modoCuenta && (fallo || otraCuenta) && (
          <ActionButton label={t('captcha.relogin')} action={() => void reconectarConBoton()} variant="primary" full />
        )}
        {!modoCuenta && fallo && (
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
