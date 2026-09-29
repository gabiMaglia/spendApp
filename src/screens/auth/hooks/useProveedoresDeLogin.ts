import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Prepara los dos proveedores al montar el login (T-223: salió de
 * `app/auth/index.tsx`, mismos efectos y en el mismo orden). Devuelve si el
 * botón nativo de Apple se puede mostrar.
 */
export function useProveedoresDeLogin(): boolean {
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

  return appleAvailable;
}
