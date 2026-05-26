import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import 'react-native-get-random-values';

import '@/src/i18n'; // inicializar i18next antes de cualquier render
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGuard() {
  const segments = useSegments();
  const router = useRouter();
  const { currentUser, isLoading, hydrate } = useAuthStore();

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === 'auth';
    if (!currentUser && !inAuth) {
      router.replace('/auth');
    } else if (currentUser && inAuth) {
      router.replace('/(tabs)');
    }
  }, [currentUser, isLoading, segments]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard />
      <Stack>
        <Stack.Screen name="auth"   options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="groups/[id]"  options={{ headerShown: false }} />
        <Stack.Screen name="groups/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/new"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settle/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="settings"     options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
