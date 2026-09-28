import { createSecureStorage } from '@/src/utils/secureStorage';
import { createSerialQueue } from '@/src/utils/serialQueue';
import { useAuthStore } from '@/src/store/authStore';

/**
 * Storage cifrado + marcador de dueño + cola FIFO de la sesión del buzón —
 * salió de `relaySession.ts` (T-192) para bajarlo de 561 líneas.
 */

/** Adaptador de storage para `auth-js`: mismo cifrado at-rest que el resto de
 *  los datos sensibles (`SECURE_IDS`), un id de bucket propio (`'sbauth'`). */
const storage = createSecureStorage('sbauth');

export function supabaseAuthStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  return {
    getItem: k => storage.getString(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: k => storage.delete(k),
  };
}

/**
 * `supabase.auth.signOut({ scope: 'local' })` sigue haciendo un viaje de red
 * incluso para `local` (`GoTrueClient.js:_signOut`), y si ese viaje falla con
 * algo que no sea 404/401/403/sesión-ausente, auth-js devuelve el error ANTES
 * de llegar a `_removeSession()` — la sesión anónima vieja queda pegada en el
 * storage para siempre, sin red o con red mala. Vaciar el bucket a mano es
 * seguro porque `'sbauth'` es EXCLUSIVO de la sesión del buzón (nada más vive
 * ahí) y no depende de conocer la clave interna que usa auth-js.
 */
export function forceClearPersistedSession(): void {
  storage.clearAll();
}

/**
 * T-175 (B2, verifier ronda 2): clave propia en el MISMO bucket `'sbauth'`
 * que la sesión — se purga JUNTO con ella (una sola `storage.clearAll()`),
 * nunca puede sobrevivir sin la sesión que describe.
 *
 * **Por qué esto y no `identityAlias.esYo()`, aunque el verifier pidió
 * reusarlo textualmente:** `data.session.user.id` es el UUID INTERNO que
 * genera Supabase Auth al resolver `signInWithIdToken` — no el `sub` del
 * proveedor que usa `currentUser.id` (y por lo tanto `esYo`). Son dos
 * espacios de id distintos; comparar uno contra el otro rompe el camino
 * FELIZ (confirmado: `esYo(data.session.user.id)` reventaba `estadosDeSesionT147b.
 * test.ts` fila 11 y `cuentaAuthorizationBuzon.test.ts`, los dos contra el
 * contrato REAL de GoTrue). Para que `esYo` diera `true` ahí habría que
 * REGISTRAR ese UUID como alias en `identityAlias.ts` — el módulo que
 * ADR-008 blinda a propósito para que sólo una fusión de cuentas real
 * (T-048) le sume identidades, porque `idCanonico`/`rosterCanonico` (que sí
 * llegan a la aritmética de saldos) comparten ese mismo set. Usarlo acá
 * como bookkeeping de sesión lo envenenaría para algo que no tiene nada que
 * ver con fusionar cuentas.
 */
const DUENO_KEY = 'cuenta_dueno_de_sesion';

type MarcadorDueno = { cuenta: string; sesion: string };

/**
 * Deja constancia de QUÉ CUENTA confirmó QUÉ SESIÓN de Supabase.
 *
 * **T-175 (B2ii bis, verifier ronda 3, rechazo):** la primera versión sólo
 * guardaba `currentUser.id` — nunca a qué `session.user.id` de Supabase
 * pertenecía. Con B logueado de verdad (marcador = 'B') y DESPUÉS una
 * sesión de OTRO `user.id` (p.ej. A, llegada tarde sin pasar por el
 * purgado de B2i) pisando el storage, la comparación vieja
 * (`marcador === currentUser.id`) daba B == B — TRUE — y devolvía
 * `'identity'` con el JWT ajeno igual: exactamente el caso que motivó B2
 * desde el principio. Guardar el PAR y exigir que coincidan los DOS
 * (`ensureRelaySession`, `relaySession.ts`) es lo que lo cierra: un
 * `user.id` que el marcador no confirmó nunca pasa, sin importar si la
 * cuenta activa es la correcta.
 *
 * La llama `directoryAuth.signIntoDirectory` sólo tras un login que
 * resolvió DE VERDAD (nunca en el timeout, nunca en un rechazo) — es la
 * única vez que hay una confirmación real de Supabase Auth detrás:
 * `ensureRelaySession` nunca establece confianza nueva por sí sola, sólo la
 * CONFIRMA contra lo que ya quedó registrado acá.
 */
export function registrarDuenoDeSesionDeCuenta(sessionUserId: string): void {
  const uid = useAuthStore.getState().currentUser?.id;
  if (uid) storage.set(DUENO_KEY, JSON.stringify({ cuenta: uid, sesion: sessionUserId } satisfies MarcadorDueno));
}

/** Lee el marcador de dueño. Dato corrupto o ausente se trata como "sin
 *  marcador" — nunca se inventa una confirmación que no está. */
export function leerDuenoDeSesion(): MarcadorDueno | null {
  const raw = storage.getString(DUENO_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MarcadorDueno>;
    return typeof v.cuenta === 'string' && typeof v.sesion === 'string' ? (v as MarcadorDueno) : null;
  } catch {
    return null;
  }
}

/**
 * FIFO de TODO lo que toca la sesión del cliente unificado del buzón: una
 * lectura (`ensureRelaySession`), un reinicio forzado (`reabrirSesionAnonima`,
 * cambio de cuenta/logout) y — T-147-b, fix D1 (verifier, ronda 2, rechazo
 * bloqueante) — el login/logout de CUENTA (`directoryAuth.ts`). Antes del
 * fix, `directoryAuth.ts` tenía su PROPIA cola: `app/auth/index.tsx` dispara
 * el login (`entrarAlDirectorio` → `signIntoDirectory`) SIN `await` justo
 * después de `setUser`, y `verify.tsx` (o `startRelay`) lee la sesión casi
 * en el mismo instante — con colas separadas, esa lectura no esperaba nada
 * del login en vuelo y leía 'none' sobre un login que en realidad iba a
 * salir bien ("No se pudo confirmar tu acceso" después de un login
 * correcto). Una cola COMPARTIDA hace que la lectura quede detrás del login
 * ya encolado, y de paso deja a `haySesionEnCurso()` (abajo) ver también el
 * login en vuelo — sin eso, el guard R4-3 de `relayEngine.ts` no podía
 * distinguir "sin sesión todavía" de "login resolviéndose solo".
 */
const cola = createSerialQueue();

/**
 * ¿Hay alguna operación de sesión del buzón en vuelo? La usa `relayEngine`
 * para no reportar "sin sesión" sobre un login/reinicio que está por
 * resolverse solo.
 */
export function haySesionEnCurso(): boolean {
  return cola.pendientes() > 0;
}

/**
 * Encola una operación sobre la sesión del cliente unificado del buzón, en
 * la MISMA cola que `ensureRelaySession`/`reabrirSesionAnonima` — fix D1.
 * La usa `directoryAuth.ts` para el login/logout de CUENTA (`signIntoDirectory`
 * / `signOutOfDirectory`): ese mismo cliente es el que lee `relaySession.ts`
 * para una cuenta, así que las dos operaciones tienen que serializarse entre
 * sí, no correr en colas que no se enteran una de la otra.
 */
export function encolarOperacionDeSesion<T>(fn: () => Promise<T>): Promise<T> {
  return cola.run(fn);
}
