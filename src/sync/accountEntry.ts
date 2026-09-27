import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { esYo } from '@/src/store/identityAlias';
import { marcarProveedorProbado } from '@/src/store/authStore';
import { signIntoDirectory } from './directoryAuth';
import { registerDeviceKey } from './deviceKeys';

/**
 * Reconexión de CUENTA para el buzón (T-147-b, `engram/plans/T-147.md`,
 * Task 3 — sellado por el PO 2026-09-27).
 *
 * **Vive ENTERAMENTE acá y en `app/auth/verify.tsx` — a propósito.** El §QUÉ
 * es explícito: "no repite las 5 rondas" del Arbitraje P-2 descartado
 * (`relayGate`, vínculo por proveedor, 17 estados, el módulo
 * `accountReconnect` con su botón «Reconectar»). El defecto de fondo de
 * aquel diseño era la reconexión y la validación desparramadas por el sync
 * y el FIFO; acá están en un único lugar (la pantalla de entrada) y el
 * fondo (`relaySession.ts`) sólo LEE la sesión que este módulo deja.
 *
 * **La comparación de identidad usa `esYo` (T-048), no una igualdad cruda**
 * de `currentUser.id`: alguien que enlazó Google y Apple ANTES de que T-048
 * existiera tiene un `sub` de proveedor viejo que no es literalmente el id
 * de cuenta activo, pero SÍ es una identidad suya (alias). Comparar sólo
 * contra `currentUser.id` rechazaría, con el mensaje de "otra cuenta", a la
 * persona correcta.
 *
 * Nunca guarda nada si la identidad no coincide: `signIntoDirectory` (y con
 * él, la sesión del buzón) sólo se toca cuando `esYo(sub)` ya dijo que sí.
 */
export type AccountEntryResult =
  | { status: 'ok' }
  | { status: 'other_account' }
  | { status: 'failed'; reason: 'no_credential' | 'no_token' | 'rejected' | 'cancelled' };

type CredencialProveedor = { sub: string | null | undefined; idToken: string | null | undefined };

async function completarConCredencial(
  provider: 'google' | 'apple',
  { sub, idToken }: CredencialProveedor,
): Promise<AccountEntryResult> {
  if (!sub) return { status: 'failed', reason: 'no_credential' };

  // El rechazo de "otra cuenta" pasa PRIMERO — antes de tocar la red, y sin
  // guardar nada: es la fila 6 de la tabla, "nada guardado" es la parte que
  // importa, no sólo el mensaje.
  if (!esYo(sub)) return { status: 'other_account' };

  if (!idToken) return { status: 'failed', reason: 'no_token' };

  const entrada = await signIntoDirectory(provider, idToken);
  if (!entrada.ok) return { status: 'failed', reason: 'rejected' };

  // Misma prueba de T-042 que usa el login normal (`app/auth/index.tsx`): el
  // directorio aceptó el token de ESTE proveedor.
  marcarProveedorProbado(sub);
  // Idempotente del lado del server — de más no rompe, y cubre al
  // dispositivo que nunca llegó a registrarse (T-078).
  void registerDeviceKey();

  return { status: 'ok' };
}

/**
 * Extrae `{ sub, idToken }` de la respuesta de Google — la forma exacta
 * varía entre variantes del SDK instalado (`{type,data}` tipado vs. el
 * `{user}`/`{data:{user}}` viejo que ya maneja `app/auth/index.tsx`); se
 * contemplan las dos, nunca se asume una sola.
 */
function credencialDeGoogle(resp: unknown): CredencialProveedor {
  const r = resp as {
    type?: string; data?: { user?: { id?: string }; idToken?: string | null } | null;
    user?: { id?: string }; idToken?: string | null;
  };
  if (r?.type === 'cancelled' || r?.type === 'noSavedCredentialFound') return { sub: null, idToken: null };
  const user = r?.data?.user ?? r?.user;
  const idToken = r?.data?.idToken ?? r?.idToken;
  return { sub: user?.id, idToken };
}

/**
 * Fila 4: cuenta Google que ACTUALIZA sin sesión del buzón — reconexión
 * SILENCIOSA. Si Google no tiene una sesión guardada (dispositivo nunca
 * logueado con este SDK, o la revocó) devuelve `no_credential` SIN mostrar
 * nada — `verify.tsx` cae al botón interactivo.
 */
export async function reconectarGoogleSilencioso(): Promise<AccountEntryResult> {
  try {
    const resp = await GoogleSignin.signInSilently();
    const cred = credencialDeGoogle(resp);
    if (!cred.sub) return { status: 'failed', reason: 'no_credential' };
    return completarConCredencial('google', cred);
  } catch {
    return { status: 'failed', reason: 'no_credential' };
  }
}

/**
 * Fila 5 (Apple, siempre interactivo — no existe un silencioso equivalente)
 * y fallback de la fila 4 (Google, cuando el silencioso no alcanzó): botón
 * «Volvé a iniciar sesión» — corre el flujo INTERACTIVO del proveedor.
 */
export async function reconectarInteractivo(provider: 'google' | 'apple'): Promise<AccountEntryResult> {
  try {
    if (provider === 'apple') {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      return completarConCredencial('apple', { sub: cred.user, idToken: cred.identityToken });
    }

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const resp = await GoogleSignin.signIn();
    const cred = credencialDeGoogle(resp);
    if (!cred.sub) return { status: 'failed', reason: 'cancelled' };
    return completarConCredencial('google', cred);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === 'ERR_REQUEST_CANCELED') {
      return { status: 'failed', reason: 'cancelled' };
    }
    return { status: 'failed', reason: 'rejected' };
  }
}
