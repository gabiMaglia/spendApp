import { useAuthStore } from '@/src/store/authStore';
import { requestReconnect } from './accountReconnectBridge';
import { signIntoDirectory } from './directoryAuth';

/**
 * Reconexión INTERACTIVA de la cuenta activa (T-147 R3-1) — lo que dispara el
 * botón «Reconectar» del aviso «sin sesión» (`SinSesionDeSync`).
 *
 * A diferencia de la reconexión en silencio de `relaySession` (automática, en
 * cada `ensureRelaySession`), ésta SIEMPRE puede mostrarle algo al usuario
 * (el diálogo nativo de Google o Apple) — es la vía de escape para Apple
 * (sin reconexión silenciosa) y para cualquier fallo silencioso de Google
 * (token revocado, primera vez que la reconexión automática no alcanza).
 */
export async function reconectarCuentaInteractivo(): Promise<boolean> {
  const user = useAuthStore.getState().currentUser;
  if (!user || (user.authProvider !== 'google' && user.authProvider !== 'apple')) return false;

  const r = await requestReconnect(user.authProvider, 'interactive');
  if (r.status !== 'ok') return false;

  const login = await signIntoDirectory(user.authProvider, r.idToken);
  return login.ok;
}
