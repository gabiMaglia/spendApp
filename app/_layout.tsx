import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import 'react-native-get-random-values';

import '@/src/i18n'; // inicializar i18next antes de cualquier render
import { bootstrapSecureStorage } from '@/src/utils/secureStorage';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/src/constants/colors';
import { syncAndroidNavigationBar } from '@/src/services/androidNavigationBar';
import { AnimatedSplash } from '@/src/components/AnimatedSplash';
import { useAuthStore } from '@/src/store/authStore';
import { useThemeStore } from '@/src/store/themeStore';
import { rehydrateForActiveUser, subscribeSessionRehydrate } from '@/src/store/session';
import { resumePendingDeletion } from '@/src/services/deleteAccount';
import { tomarEnlacePendiente } from '@/src/utils/enlacePendiente';
import { useEnlacesEntrantes } from '@/src/hooks/useEnlacesEntrantes';
import { installNotificationHandler } from '@/src/services/notifications';
import { installGlobalErrorHandler } from '@/src/services/globalErrorHandler';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { exportarDiagnostico } from '@/src/services/exportDiagnostico';

// A nivel de módulo, no dentro de un componente: el handler tiene que estar
// registrado ANTES de que llegue el primer aviso. Sin él, expo-notifications
// descarta en silencio todo lo que llegue con la app en primer plano.
installNotificationHandler();

/**
 * También a nivel de módulo, y por la misma razón llevada al extremo: lo que
 * este handler existe para ver son los errores del arranque, que ocurren antes
 * de que ningún componente haya montado (T-078 · §5.3). Si `ErrorUtils` no está
 * —es API interna de React Native—, esto no hace nada y la app arranca igual.
 */
installGlobalErrorHandler();

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGuard() {
  const segments = useSegments();
  const router = useRouter();
  const { currentUser, isLoading, hydrate } = useAuthStore();
  const hydrateTheme    = useThemeStore(s => s.hydrate);

  useEffect(() => {
    // Tema en claro y síncrono: se puede hidratar ya (evita flash).
    hydrateTheme();

    // Stores sensibles: primero abrimos los buckets cifrados con la clave v2
    // del llavero (haciendo el arranque en limpio de una sola vez, T-124 L-E,
    // si todavía no corrió), recién ahí hidratamos los datos de la cuenta
    // activa. authStore arranca isLoading:true, así que el AuthGuard espera
    // este await.
    let active = true;
    (async () => {
      await bootstrapSecureStorage();
      if (!active) return;
      hydrate();                 // carga la sesión (cuál cuenta está activa)
      rehydrateForActiveUser();  // carga los datos SCOPEADOS de esa cuenta

      // Un borrado de cuenta que quedó a medias —sin red, o con la app cerrada
      // en el medio— se termina acá. Va SIN await: el arranque no espera a la
      // red, y si tampoco hay ahora, se reintenta el próximo arranque.
      // Va en el layout raíz y no en la re-hidratación por cuenta porque
      // después de borrar NO hay cuenta activa que la dispare.
      void resumePendingDeletion();
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
      const pendiente = tomarEnlacePendiente();
      if (pendiente) router.push(pendiente as any);
    }
  }, [currentUser, isLoading, segments]);

  /**
   * **Links sin sesión.** Con sesión, expo-router abre la pantalla del link (filtrada por
   * `app/+native-intent.tsx`) y la pantalla lo procesa. Sin sesión, el guard redirige al
   * login: el link queda pendiente y se abre al entrar (rama de arriba). Qué queda
   * pendiente se decide cuando el link LLEGA, no cuando cambia la sesión (T-094).
   */
  useEnlacesEntrantes();

  return null;
}

/*
 * El splash nativo se mantiene hasta que React monta, y se esconde apenas
 * montó para dejar correr el splash ANIMADO. Los dos son negros, así que el
 * cambio de uno al otro no se ve. Sin esto, Expo esconde el nativo por su
 * cuenta antes de tiempo y aparece un frame de la app antes de la animación.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Si falla, la app arranca igual: se pierde la animación, no la app.
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [splashListo, setSplashListo] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // T-137: la barra de tres botones de Android, si no, no hereda el tema
  // (ver `androidNavigationBar.ts`). No-op en iOS.
  useEffect(() => {
    const scheme = colorScheme === 'dark' ? 'dark' : 'light';
    void syncAndroidNavigationBar(Colors[scheme].bg, scheme);
  }, [colorScheme]);

  // GestureHandlerRootView: los gestos (deslizar para archivar) NO funcionan
  // sin esta raíz, y fallan EN SILENCIO — el swipe simplemente no responde.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard />
      {/*
        Envuelve al Stack y no a la app entera: adentro del ThemeProvider la
        pantalla de recuperación puede leer el tema, y `AuthGuard` —que no
        dibuja nada— queda afuera para que un error de render no se lleve la
        hidratación de la sesión con él.

        Los textos van ya traducidos: el límite de error no puede llamar a
        `t()` (ver `ErrorBoundary`).
      */}
      <ErrorBoundary
        textos={{
          title: t('error.boundary_title'),
          body: t('error.boundary_body'),
          retry: t('error.retry'),
          exportar: t('error.export_diagnostics'),
        }}
        onExport={() => {
          void exportarDiagnostico({
            dialogTitle: t('error.export_diagnostics'),
            error: t('error.export_error'),
          });
        }}
      >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth/index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="groups/[id]"  options={{ headerShown: false }} />
        <Stack.Screen name="groups/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="groups/join"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="groups/leave" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/new"  options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settle/new"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="contact/add"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sync/index"   options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="debug/identity" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="debug/relay"    options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
      </ErrorBoundary>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {!splashListo && <AnimatedSplash onDone={() => setSplashListo(true)} />}
    </ThemeProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
