import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { signIntoDirectory } from '@/src/sync/directoryAuth';
import { registerDeviceKey } from '@/src/sync/deviceKeys';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';
import { Button } from '@/src/components/Button';

type GoogleUser = {
  id: string;
  name?: string | null;
  email: string;
  photo?: string | null;
  givenName?: string | null;
};

export default function AuthScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { setUser, getStoredProfile, resolveAccount, confirmAccountLink } = useAuthStore();

  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  // Google Sign-In nativo (@react-native-google-signin). En Android usa el
  // cliente OAuth Android registrado en GCP (paquete + SHA-1) — no requiere ID
  // en código. En iOS necesita iosClientId. webClientId es opcional (solo para
  // idToken; acá el auth es serverless y usamos el perfil directo).
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || undefined,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS || undefined,
      offlineAccess: false,
    });
  }, []);


  // Resuelve a qué cuenta entra este login. Si el proveedor no mandó email
  // (Apple sólo lo manda la 1ª vez) y ya hay otras cuentas en el device, no se
  // adivina: se le pregunta al usuario (decisión del PO). Devuelve el id de
  // cuenta, o null si el usuario todavía tiene que decidir.
  function accountIdFor(
    providerId: string,
    email: string | null | undefined,
    onResolved: (accountId: string) => void,
  ) {
    const r = resolveAccount(providerId, email);

    if (r.kind !== 'confirm') { onResolved(r.accountId); return; }

    const candidate = r.candidates[0];
    Alert.alert(
      t('auth.link_title'),
      t('auth.link_body', { account: candidate.label }),
      [
        {
          text: t('auth.link_separate'),
          style: 'cancel',
          onPress: () => onResolved(providerId), // cuenta propia
        },
        {
          text: t('auth.link_confirm'),
          onPress: () => {
            confirmAccountLink(providerId, candidate.accountId);
            onResolved(candidate.accountId);
          },
        },
      ],
    );
  }

  /**
   * Entra al directorio de claves y registra la de este dispositivo.
   *
   * Best effort de punta a punta: si Supabase Auth no está configurado, si el
   * proveedor no mandó `id_token` o si la RLS rechaza, no pasa nada — la app
   * funciona igual que antes de que esto existiera (ADR-004, fase A).
   */
  async function entrarAlDirectorio(proveedor: 'google' | 'apple', idToken?: string | null) {
    const entrada = await signIntoDirectory(proveedor, idToken);
    if (!entrada.ok) return;
    await registerDeviceKey();
  }

  async function handleGoogleLogin() {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // La forma del retorno varía por versión; contemplamos {data:{user}} y {user}.
      const response = (await GoogleSignin.signIn()) as unknown as {
        data?: { user?: GoogleUser; idToken?: string | null };
        user?: GoogleUser;
        idToken?: string | null;
      };
      const u = response?.data?.user ?? response?.user;
      if (!u) return; // cancelado

      // Mismo mail ⇒ misma cuenta, entre con Google o con Apple.
      accountIdFor(u.id, u.email, (accountId) => {
        setUser(mergeProviderUser(getStoredProfile(accountId), {
          id:           accountId,
          authProvider: 'google',
          name:         u.name ?? u.givenName,
          email:        u.email,
          avatarUrl:    u.photo,
        }));

        // Directorio de claves (ADR-004): se aprovecha el MISMO id_token del
        // login, así que no hay una segunda pantalla para el usuario. Va sin
        // await y sin bloquear: si falla, la app entra igual.
        void entrarAlDirectorio('google', response?.data?.idToken ?? response?.idToken);
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return;
      alert(t('auth.error_google'));
    }
  }

  async function handleAppleLogin() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      // Apple manda fullName y email SOLO en el primer login de cada Apple ID;
      // después llegan null. Por eso NO se arma el User acá: mergeProviderUser
      // combina lo que llegue con el perfil ya persistido (que sobrevive al
      // signOut) y deja ganar al dato local. Ver src/utils/mergeProviderUser.ts.
      const name = [
        credential.fullName?.givenName,
        credential.fullName?.familyName,
      ].filter(Boolean).join(' ');

      accountIdFor(credential.user, credential.email, (accountId) => {
        setUser(mergeProviderUser(getStoredProfile(accountId), {
          id:           accountId,
          authProvider: 'apple',
          name,
          email:        credential.email,
        }));

        void entrarAlDirectorio('apple', credential.identityToken);
      });
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        alert(t('auth.error_apple'));
      }
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <AppLogoMark size={84} />
          <View style={styles.heroText}>
            <Text style={[Typography.display, { color: c.text, textAlign: 'center', lineHeight: 40 }]}>
              {t('auth.welcome_title')}
            </Text>
            <Text style={[Typography.bodyL, { color: c.textSecondary, textAlign: 'center', maxWidth: 280 }]}>
              {t('auth.welcome_subtitle')}
            </Text>
          </View>
        </View>

        {/* CTAs */}
        <View style={styles.ctas}>
          {/* Apple — botón nativo (obligatorio para App Store) */}
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={14}
              style={styles.appleButton}
              onPress={handleAppleLogin}
            />
          )}

          {/* Google */}
          <Button variant={appleAvailable ? 'secondary' : 'primary'} size="lg" block onPress={handleGoogleLogin}>
            {t('auth.continue_google')}
          </Button>

          <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
            {t('auth.terms_prefix')}{' '}
            <Text style={{ color: c.brand.primary, fontWeight: '600' }}>{t('auth.terms_link')}</Text>
            {' '}{t('auth.privacy_and')}{' '}
            <Text style={{ color: c.brand.primary, fontWeight: '600' }}>{t('auth.privacy_link')}</Text>
            {'. '}{t('auth.terms_suffix')}
          </Text>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppLogoMark({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <View style={{
        position: 'absolute', left: 0, top: 0,
        width: size * 0.78, height: size * 0.78,
        borderRadius: size * 0.26, backgroundColor: '#0A6E8F',
      }} />
      <View style={{
        position: 'absolute', right: 0, bottom: 0,
        width: size * 0.68, height: size * 0.68,
        borderRadius: size * 0.22, backgroundColor: '#8FBC94', opacity: 0.85,
      }} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#fff', fontSize: size * 0.31, fontWeight: '800', letterSpacing: -2 }}>S</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  // Sin la tarjeta de ejemplo el hero quedaba arriba y los botones abajo, con un
  // hueco en medio. Ahora el contenido se centra vertical y el bloque de botones
  // se queda pegado al final: la pantalla se lee como una sola pieza.
  scroll:      {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.screenPad,
    paddingTop: Spacing[8],
  },
  hero:        { alignItems: 'center', gap: 24, marginBottom: Spacing[8] },
  heroText:    { alignItems: 'center', gap: 8 },
  ctas:        { gap: 10, paddingBottom: Spacing[4] },
  appleButton: { width: '100%', height: 50 },
});
