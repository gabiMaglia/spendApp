import { useEffect } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { registerReconnectProvider, type ReconnectOutcome } from '@/src/sync/accountReconnectBridge';

/**
 * Host de la reconexión de cuentas (T-147 R3-1) — headless, mismo patrón que
 * `CaptchaHost`/`captchaBridge`: `relaySession` no puede importar los SDKs
 * nativos directo (rompería sus tests, que no montan nada nativo), así que
 * este componente se monta UNA vez en `_layout` y registra el puente.
 *
 * `GoogleSignin.configure()` corre acá y no sólo en la pantalla de login
 * (`app/auth/index.tsx`) — con D5 (T-147), el motor de sync no arranca sin
 * `currentUser`, así que la reconexión sólo importa DESPUÉS del login, con
 * la pantalla de auth ya desmontada. Sin este `configure()` acá, `signInSilently`
 * fallaría por "no configurado" para cualquiera que ya esté adentro.
 *
 *  - Google: `'silent'` usa `signInSilently()` (sin tocar al usuario);
 *    `'interactive'` es el mismo flujo de botón que el login normal.
 *  - Apple: no tiene reconexión silenciosa — `'silent'` siempre
 *    `not_available`; `'interactive'` abre el diálogo nativo de Apple.
 */
export function AccountReconnectHost() {
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || undefined,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS || undefined,
      offlineAccess: false,
    });

    registerReconnectProvider(async (provider, mode) => {
      try {
        if (provider === 'google') return await reconectarGoogle(mode);
        if (provider === 'apple') return await reconectarApple(mode);
        return { status: 'not_available' };
      } catch {
        return { status: 'failed' };
      }
    });

    return () => registerReconnectProvider(null);
  }, []);

  return null;
}

async function reconectarGoogle(mode: 'silent' | 'interactive'): Promise<ReconnectOutcome> {
  if (mode === 'silent') {
    if (!GoogleSignin.hasPreviousSignIn()) return { status: 'not_available' };
    const r = await GoogleSignin.signInSilently();
    if (r.type !== 'success') return { status: 'not_available' };
    return r.data.idToken ? { status: 'ok', idToken: r.data.idToken } : { status: 'failed' };
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const r = await GoogleSignin.signIn();
  if (r.type !== 'success') return { status: 'failed' };
  return r.data.idToken ? { status: 'ok', idToken: r.data.idToken } : { status: 'failed' };
}

async function reconectarApple(mode: 'silent' | 'interactive'): Promise<ReconnectOutcome> {
  // Apple no tiene equivalente de `signInSilently`: no hay forma de
  // reconectar sin mostrarle nada al usuario.
  if (mode === 'silent') return { status: 'not_available' };

  const cred = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
  });
  return cred.identityToken ? { status: 'ok', idToken: cred.identityToken } : { status: 'failed' };
}
