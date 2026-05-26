import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { Button } from '@/src/components/Button';
import { BalancePill } from '@/src/components/BalancePill';
import { Avatar } from '@/src/components/Avatar';

export default function AuthScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { setUser } = useAuthStore();

  const googleIosId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? '';
  const googleConfigured = googleIosId.length > 0 && !googleIosId.startsWith('000000');

  // El hook siempre necesita un string — pasamos el placeholder si no está configurado.
  // El auth real solo se dispara cuando googleConfigured es true.
  const [, , promptGoogleAsync] = Google.useAuthRequest({
    iosClientId:     googleIosId || 'not-configured',
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? 'not-configured',
    webClientId:     process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? 'not-configured',
  });

  async function handleGoogleLogin() {
    if (!googleConfigured) {
      alert('Configurá EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS en el archivo .env');
      return;
    }
    const result = await promptGoogleAsync();
    if (result.type !== 'success') return;

    const res = await fetch('https://www.googleapis.com/userinfo/v2/me', {
      headers: { Authorization: `Bearer ${result.authentication?.accessToken}` },
    });
    const userInfo = await res.json();

    setUser({
      id:           userInfo.id,
      name:         userInfo.name,
      email:        userInfo.email,
      avatarUrl:    userInfo.picture,
      authProvider: 'google',
      updatedAt:    Date.now(),
      isDeleted:    false,
      createdAt:    Date.now(),
    });
  }

  async function handleAppleLogin() {
    // TODO: implementar con expo-apple-authentication en dev build
  }

  function handleGuestLogin() {
    setUser({
      id:           'u0',
      name:         'Lucas Rivera',
      email:        'lucas@example.com',
      authProvider: 'google',
      updatedAt:    Date.now(),
      isDeleted:    false,
      createdAt:    Date.now(),
    });
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

          {/* Mini balance demo */}
          <View style={[styles.demoCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <DemoRow name="Ana" hue={0} amount={4500} />
            <View style={[styles.divider, { backgroundColor: c.borderHair }]} />
            <DemoRow name="Bob" hue={1} amount={-2100} />
          </View>
        </View>

        {/* CTAs */}
        <View style={styles.ctas}>
          <Button variant="primary" size="lg" block onPress={handleAppleLogin}>
            {t('auth.continue_apple')}
          </Button>
          <Button variant="secondary" size="lg" block onPress={handleGoogleLogin}>
            {t('auth.continue_google')}
          </Button>
          <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
            {t('auth.terms_prefix')}{' '}
            <Text style={{ color: c.brand.primary, fontWeight: '600' }}>{t('auth.terms_link')}</Text>
            {' '}{t('auth.privacy_and')}{' '}
            <Text style={{ color: c.brand.primary, fontWeight: '600' }}>{t('auth.privacy_link')}</Text>
            {'. '}{t('auth.terms_suffix')}
          </Text>

          {__DEV__ && (
            <Button variant="ghost" size="sm" block onPress={handleGuestLogin}>
              ⚡ Entrar como invitado (solo dev)
            </Button>
          )}
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
        width: size * 0.72, height: size * 0.72,
        borderRadius: size * 0.24, backgroundColor: '#0A6E8F',
      }} />
      <View style={{
        position: 'absolute', right: 0, bottom: 0,
        width: size * 0.62, height: size * 0.62,
        borderRadius: size * 0.2, backgroundColor: '#8FBC94', opacity: 0.85,
      }} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '800', letterSpacing: -2 }}>S</Text>
      </View>
    </View>
  );
}

function DemoRow({ name, hue, amount }: { name: string; hue: number; amount: number }) {
  return (
    <View style={styles.demoRow}>
      <Avatar name={name} hue={hue} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={[Typography.bodyM, { fontWeight: '600', color: '#1F1A14' }]}>{name}</Text>
      </View>
      <BalancePill amount={amount} currency="ARS" size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1 },
  scroll:   { flexGrow: 1, padding: Spacing.screenPad, paddingTop: Spacing[8] },
  hero:     { flex: 1, alignItems: 'center', gap: 32, marginBottom: 32 },
  heroText: { alignItems: 'center', gap: 8 },
  demoCard: {
    width: '100%', maxWidth: 320,
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: 10,
  },
  demoRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider:  { height: 1 },
  ctas:     { gap: 10, paddingBottom: Spacing[8] },
});
