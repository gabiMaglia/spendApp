import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import 'react-native-get-random-values';

import '@/src/i18n'; // inicializar i18next antes de cualquier render
import { bootstrapSecureStorage } from '@/src/utils/secureStorage';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useThemeStore } from '@/src/store/themeStore';
import { rehydrateForActiveUser, subscribeSessionRehydrate } from '@/src/store/session';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGuard() {
  const segments = useSegments();
  const router = useRouter();
  const { currentUser, isLoading, hydrate } = useAuthStore();
  const addOrUpdateUser = useUserStore(s => s.addOrUpdateUser);
  const hydrateTheme    = useThemeStore(s => s.hydrate);

  useEffect(() => {
    // Tema en claro y síncrono: se puede hidratar ya (evita flash).
    hydrateTheme();

    // Stores sensibles: primero abrimos el storage CIFRADO (carga la clave del
    // llavero + migra datos en claro a cifrado in-place), recién ahí hidratamos
    // los datos de la cuenta activa. authStore arranca isLoading:true, así que
    // el AuthGuard espera este await.
    let active = true;
    (async () => {
      await bootstrapSecureStorage();
      if (!active) return;
      hydrate();                 // carga la sesión (cuál cuenta está activa)
      rehydrateForActiveUser();  // carga los datos SCOPEADOS de esa cuenta
    })();

    // Re-hidrata al cambiar de cuenta (login / logout / switch de usuario).
    const unsub = subscribeSessionRehydrate();
    return () => { active = false; unsub(); };
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === 'auth';
    if (!currentUser && !inAuth) {
      router.replace('/auth');
    } else if (currentUser && inAuth) {
      router.replace('/(tabs)');
    }
  }, [currentUser, isLoading, segments]);

  // Deep link handler for contact/add?id=...&name=...&email=...
  useEffect(() => {
    function handleUrl({ url }: { url: string }) {
      try {
        const parsed = Linking.parse(url);
        if (parsed.path === 'contact/add' && parsed.queryParams) {
          const { id, name, email } = parsed.queryParams as Record<string, string>;
          if (id && name && currentUser && id !== currentUser.id) {
            addOrUpdateUser({
              id,
              name,
              email: email ?? '',
              authProvider: 'google',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              isDeleted: false,
            });
          }
        }
      } catch {}
    }

    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then(url => { if (url) handleUrl({ url }); });
    return () => sub.remove();
  }, [currentUser]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth"   options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="groups/[id]"  options={{ headerShown: false }} />
        <Stack.Screen name="groups/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="groups/join"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/new"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settle/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="contact/add"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="settings"     options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sync/index"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sync/webrtc"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="debug/webrtc" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="debug/identity" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="debug/relay"    options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
    </SafeAreaProvider>
  );
}
