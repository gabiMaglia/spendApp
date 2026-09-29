import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { marcarProveedorProbado } from '@/src/store/authStore';
import { signIntoDirectory } from '@/src/sync/sesion/directoryAuth';
import { registerDeviceKey } from '@/src/sync/confianza/deviceKeys';

/** T-223: salió de `app/auth/index.tsx` junto con las dos funciones de abajo. */
export type GoogleUser = {
  id: string;
  name?: string | null;
  email: string;
  photo?: string | null;
  givenName?: string | null;
};

/**
 * Entra al directorio de claves y registra la de este dispositivo.
 *
 * Best effort de punta a punta: si Supabase Auth no está configurado, si el
 * proveedor no mandó `id_token` o si la RLS rechaza, no pasa nada — la app
 * funciona igual que antes de que esto existiera (ADR-004, fase A).
 */
export async function entrarAlDirectorio(
  proveedor: 'google' | 'apple',
  idToken: string | null | undefined,
  providerId: string,
): Promise<boolean> {
  const entrada = await signIntoDirectory(proveedor, idToken);
  if (!entrada.ok) return false;
  // La prueba de T-042: el directorio aceptó el token de ESTE proveedor.
  marcarProveedorProbado(providerId);
  await registerDeviceKey();
  return true;
}

/**
 * Prueba el proveedor de la cuenta destino **sin cambiar de sesión**: corre su
 * login y se lo presenta al directorio, nada más.
 *
 * Existe porque sin esto la fusión legítima sería imposible: la prueba es de
 * la sesión, y la otra cuenta no se probó en ésta. Es el único momento en que
 * pedirle al usuario que entre con la otra cuenta tiene sentido — está acá,
 * decidiendo unirlas.
 */
export async function probarOtroProveedor(proveedor: 'google' | 'apple'): Promise<boolean> {
  try {
    if (proveedor === 'apple') {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      return entrarAlDirectorio('apple', cred.identityToken, cred.user);
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const resp = (await GoogleSignin.signIn()) as unknown as {
      data?: { user?: GoogleUser; idToken?: string | null };
      user?: GoogleUser; idToken?: string | null;
    };
    const u = resp?.data?.user ?? resp?.user;
    if (!u) return false;   // cancelado
    return entrarAlDirectorio('google', resp?.data?.idToken ?? resp?.idToken, u.id);
  } catch {
    return false;   // cancelar no es un error: simplemente no se fusiona
  }
}
