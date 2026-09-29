import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';

import { Spacing } from '@/src/constants/spacing';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Button } from '@/src/components/Button';
import { useColors } from '@/src/skins/useSkin';
import { HeroDeLogin } from '@/src/screens/auth/components/HeroDeLogin';
import { LinksLegales } from '@/src/screens/auth/components/LinksLegales';
import { useLoginSocial } from '@/src/screens/auth/hooks/useLoginSocial';
import { useProveedoresDeLogin } from '@/src/screens/auth/hooks/useProveedoresDeLogin';

// T-223: la lógica de entrada vive en `src/screens/auth` (hooks + resolución
// de cuenta + directorio); acá queda la composición.
export default function AuthScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = useColors();
  const { entrarComoInvitado, handleGoogleLogin, handleAppleLogin } = useLoginSocial();
  const appleAvailable = useProveedoresDeLogin();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <HeroDeLogin />

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

          {/* T-101-bis: modo invitado — ver `entrarComoInvitado`. */}
          <Button variant="ghost" size="lg" block onPress={entrarComoInvitado}>
            {t('auth.continue_guest')}
          </Button>

          <LinksLegales />

        </View>
      </ScrollView>
    </SafeAreaView>
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
  ctas:        { gap: 10, paddingBottom: Spacing[4] },
  appleButton: { width: '100%', height: 50 },
});
