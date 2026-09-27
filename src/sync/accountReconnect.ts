import { useAuthStore } from '@/src/store/authStore';
import { requestReconnect } from './accountReconnectBridge';
import { signIntoDirectory } from './directoryAuth';
import { validarIdentidadReconectada } from './relaySession';

/**
 * Reconexión INTERACTIVA de la cuenta activa (T-147 R3-1) — lo que dispara el
 * botón «Reconectar» del aviso «sin sesión» (`SinSesionDeSync`).
 *
 * A diferencia de la reconexión en silencio de `relaySession` (automática, en
 * cada `ensureRelaySession`), ésta SIEMPRE puede mostrarle algo al usuario
 * (el diálogo nativo de Google o Apple) — es la vía de escape para Apple
 * (sin reconexión silenciosa) y para cualquier fallo silencioso de Google
 * (token revocado, primera vez que la reconexión automática no alcanza).
 *
 * **Verifier R4-1(a) (ronda 4): el selector de cuentas es del usuario, no
 * nuestro.** Nada impide que elija una cuenta de Google DISTINTA de la que
 * ya está activa en la app — y el `idToken` que vuelve de ahí no se
 * comprobaba antes de entregárselo a `signIntoDirectory`, así que la sesión
 * del buzón podía quedar atada a un uid ajeno indefinidamente. Por eso el
 * resultado ya no es booleano: se valida la identidad DESPUÉS del login
 * (`validarIdentidadReconectada`, la misma que usa la reconexión en
 * silencio) y `'otra_cuenta'` es un caso que la UI necesita distinguir de un
 * fallo mudo para poder avisarle al usuario en vez de aceptarla en silencio.
 */
export type ResultadoReconexion = 'ok' | 'otra_cuenta' | 'failed';

export async function reconectarCuentaInteractivo(): Promise<ResultadoReconexion> {
  const user = useAuthStore.getState().currentUser;
  if (!user || (user.authProvider !== 'google' && user.authProvider !== 'apple')) return 'failed';

  const r = await requestReconnect(user.authProvider, 'interactive');
  if (r.status !== 'ok') return 'failed';

  const login = await signIntoDirectory(user.authProvider, r.idToken);
  if (!login.ok) return 'failed';

  const identidad = await validarIdentidadReconectada(user.id);
  return identidad === 'otra_cuenta' ? 'otra_cuenta' : 'ok';
}
