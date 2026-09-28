import { getRelayClient } from '@/src/sync/adaptadores/supabase/relay';
import { withTimeout } from '@/src/utils/withTimeout';

/**
 * Sesión de CUENTA contra Supabase Auth — abre la que usan el buzón Y el
 * directorio de claves (ADR-004) para una cuenta Google/Apple.
 *
 * No decide quién entra a la app: eso lo sigue resolviendo el login de siempre,
 * en el dispositivo. Acá lo único que se busca es dejarle a Supabase Auth una
 * sesión real con la que el servidor pueda probar "esta cuenta es de quien
 * está pidiendo registrar la clave" — cosa que el cliente no puede probar
 * solo — y que el buzón pueda usar ESA MISMA sesión (T-147-b) en vez de una
 * anónima.
 *
 * Se le pasa el mismo `id_token` que Google o Apple ya devuelven al loguearse:
 * no hay una segunda pantalla ni un segundo consentimiento para el usuario.
 *
 * Todo lo de acá es **best effort**: si falla, la app funciona exactamente como
 * antes de que este archivo existiera (para el buzón, `relaySession.ts`
 * simplemente sigue leyendo 'none' hasta que `verify.tsx` reconecte).
 *
 * **T-147-b (`engram/plans/T-147.md`, Task 2, sellado por el PO
 * 2026-09-27):** este login corre en el cliente del BUZÓN (`relay.ts`,
 * persistido) — ya NO existe un `directoryClient.ts` aparte. La
 * SIMPLIFICACIÓN del mismo día había separado los dos clientes para que el
 * buzón nunca llevara un JWT de cuenta; T-147-b invierte esa premisa a
 * propósito: ahora SÍ tiene que llevarlo, porque el captcha (que exige la
 * anónima) dejó de aplicar a las cuentas.
 *
 * **T-175:** el login/logout ya NO usa una cola propia — usa
 * `encolarOperacionDeSesion` de `relaySession.ts`,
 * la MISMA cola que `ensureRelaySession`/`reabrirSesionAnonima`. Antes,
 * `app/auth/index.tsx` disparaba el login (`entrarAlDirectorio` →
 * `signIntoDirectory`) SIN `await` justo después de `setUser`, y
 * `verify.tsx` leía la sesión casi en el mismo instante — con colas
 * separadas, esa lectura no esperaba nada del login en vuelo y devolvía
 * `'none'` sobre un login que en realidad iba a salir bien ("No se pudo
 * confirmar tu acceso" después de loguearse correctamente). Compartir la
 * cola también deja a `haySesionEnCurso()` ver el login en vuelo — sin eso,
 * el guard R4-3 de `relayEngine.ts` no podía distinguir "sin sesión
 * todavía" de "login resolviéndose solo". Import PEREZOSO (mismo patrón que
 * `relay.ts` → `relaySession.ts`): un `import` estático acá arriba armaría
 * un ciclo (`relaySession.ts` → `authStore.ts` → `directoryAuth.ts`); sólo
 * hace falta en tiempo de ejecución, nunca al cargar el módulo.
 *
 * **T-175:** `signInWithIdToken`/`signOut` corrían acá SIN tope de tiempo.
 * El tope de `SESSION_TIMEOUT_MS` que ya existía vive DENTRO de
 * `hacerEnsure` (`relaySession.ts`), envolviendo lo que `ensureRelaySession`
 * encola — nunca alcanza a lo que YA estaba encolado ADELANTE en la MISMA
 * cola. Un fetch colgado acá
 * bloqueaba la cola para siempre y `verify.tsx` quedaba en spinner sin
 * salida. Se reusa `withTimeout` (`src/utils/withTimeout.ts`, T-138-bis —
 * el mismo corte que ya usa `doStartRelay`) en vez de escribir otra copia,
 * y la MISMA `SESSION_TIMEOUT_MS`: un solo presupuesto de red para toda la
 * cola. Se aplica ANTES de encolar, no a la promesa ya encolada: si
 * quedara afuera, la operación colgada seguiría bloqueando la cola aunque
 * ESTA llamada se rindiera. A propósito NO pausado por el captcha —
 * login/logout de CUENTA nunca lo tocan; ese pausado (`withNetworkTimeout`)
 * es sólo del camino de invitado. Este helper genérico ahora sólo lo usa
 * `signOutOfDirectory` — `signIntoDirectory` (abajo) necesita quedarse con
 * la promesa CRUDA para vigilar una respuesta tardía que pisa otra sesión
 * (ver `vigilarRespuestaTardia` abajo), así que arma su propio tope inline
 * con la misma `withTimeout`/`SESSION_TIMEOUT_MS`.
 */
function encolar<T>(fn: () => Promise<T>, alVencer: T): Promise<T> {
  const { encolarOperacionDeSesion, SESSION_TIMEOUT_MS } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./relaySession') as typeof import('./relaySession');
  return encolarOperacionDeSesion(() => withTimeout(fn(), SESSION_TIMEOUT_MS, alVencer));
}

export type DirectorySignIn =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'no_token' | 'rejected'; detail?: string };

type ClienteAuth = NonNullable<ReturnType<typeof getRelayClient>>;

/**
 * T-175: cuando ESTA llamada vence, `withTimeout` deja de esperar la
 * promesa ORIGINAL — pero no la cancela (JS no puede) y auth-js
 * tampoco se entera de nuestro tope: en cuanto la red conteste, igual corre
 * `_saveSession` y persiste esa respuesta tardía (`GoTrueClient.js:1685-1687`).
 * Si para entonces ya entró otra cuenta, esa respuesta tardía de A LE PISA la
 * sesión a B en silencio.
 *
 * Por eso se sigue mirando la promesa original después de vencida: si
 * finalmente trae una sesión Y el `access_token` que trajo es EXACTAMENTE el
 * que quedó persistido ahora mismo, se purga. Comparar antes de borrar es lo
 * que evita tocar una sesión ajena — si B ya escribió la suya (un
 * `access_token` distinto), esto no hace nada.
 */
function vigilarRespuestaTardia(
  supabase: ClienteAuth,
  crudo: ReturnType<ClienteAuth['auth']['signInWithIdToken']>,
): void {
  void crudo.then(async ({ data }) => {
    const tokenTardio = data?.session?.access_token;
    if (!tokenTardio) return;
    const { data: actual } = await supabase.auth.getSession();
    if (actual.session?.access_token === tokenTardio) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { forceClearPersistedSession } = require('./relaySession') as typeof import('./relaySession');
      forceClearPersistedSession();
    }
  }).catch(() => {
    // La respuesta tardía rechazó: nada que persistir, nada que purgar.
  });
}

export async function signIntoDirectory(
  provider: 'google' | 'apple',
  idToken: string | null | undefined,
): Promise<DirectorySignIn> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // Sin `webClientId` configurado, el SDK de Google no devuelve `idToken`. Es
  // el fallo más probable de todos y conviene distinguirlo de un rechazo del
  // servidor: uno se arregla en el .env, el otro en el panel de Supabase.
  if (!idToken) return { ok: false, reason: 'no_token' };

  const { encolarOperacionDeSesion, SESSION_TIMEOUT_MS, registrarDuenoDeSesionDeCuenta } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./relaySession') as typeof import('./relaySession');

  return encolarOperacionDeSesion(async () => {
    // `crudo`, no envuelta en try/catch todavía: hace falta la promesa CRUDA
    // (no la ya mapeada a `DirectorySignIn`) para poder seguir mirándola
    // después de vencida (B2i, arriba).
    const crudo = supabase.auth.signInWithIdToken({ provider, token: idToken });

    const mapeado: Promise<DirectorySignIn> = crudo.then(
      ({ error }) => (error ? { ok: false, reason: 'rejected', detail: error.message } : { ok: true }),
      (e) => ({ ok: false, reason: 'rejected', detail: String(e) }),
    );

    const resultado = await withTimeout<DirectorySignIn | 'timeout'>(mapeado, SESSION_TIMEOUT_MS, 'timeout');

    if (resultado === 'timeout') {
      vigilarRespuestaTardia(supabase, crudo);
      return { ok: false, reason: 'rejected', detail: 'timeout' };
    }
    // T-175: sólo acá hay una confirmación REAL de Supabase
    // Auth detrás — se registra el PAR {cuenta, sesion} para que
    // `ensureRelaySession` (`relaySession.ts`) pueda confirmar después no
    // sólo QUIÉN está activo sino A QUÉ `session.user.id` puntual
    // corresponde, en vez de confiar en cualquier sesión no anónima que
    // encuentre con la cuenta correcta. `crudo` ya resolvió (es lo que
    // `mapeado` esperó para saber que no hubo error) — releerlo acá sólo
    // devuelve el mismo valor ya resuelto, sin pegarle a la red de nuevo.
    if (resultado.ok) {
      const { data } = await crudo;
      if (data?.session) registrarDuenoDeSesionDeCuenta(data.session.user.id);
    }
    return resultado;
  });
}

/**
 * Cierra la sesión de cuenta. Se llama al desloguearse de la app.
 *
 * `scope: 'local'`: el default de `signOut()` es `scope: 'global'` y
 * revocaría el refresh token en TODOS los dispositivos — con la sesión
 * PERSISTIDA del buzón (T-147-b) esto sí importa de verdad. Best effort y
 * redundante a propósito con `reiniciarSyncPorCambioDeCuenta`
 * (`relayEngine.ts`, que además fuerza el borrado del storage): las dos
 * corren sobre el mismo cliente y ahora también sobre la MISMA cola (fix
 * D1), así que quedan serializadas entre sí sin importar cuál se dispara
 * primero — ninguna deja un JWT de cuenta vivo.
 *
 * **T-175:** si el `signOut` de red vence sin contestar, el fallback de
 * `encolar` no puede purgar el storage por sí solo (es un valor estático,
 * no una función) — acá se detecta el vencimiento por el sentinel
 * `'timeout'` y se purga DESPUÉS, con `forceClearPersistedSession` (sin
 * otro viaje de red que también podría colgarse), para que el JWT viejo no
 * quede pegado esperando una respuesta que nunca llega.
 */
export async function signOutOfDirectory(): Promise<void> {
  const supabase = getRelayClient();
  if (!supabase) return;

  const resultado = await encolar(async (): Promise<'ok' | 'timeout'> => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Sin sesión persistida no hay nada que forzar: el próximo login del
      // directorio abre una sesión nueva sin importar cómo terminó ésta.
    }
    return 'ok';
  }, 'timeout');

  if (resultado === 'timeout') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { forceClearPersistedSession } = require('./relaySession') as typeof import('./relaySession');
    forceClearPersistedSession();
  }
}
