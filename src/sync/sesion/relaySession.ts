import { AppState } from 'react-native';
import { requestCaptchaToken } from './captchaBridge';
import { getRelayClient } from '@/src/sync/adaptadores/supabase/relay';
import { useAuthStore } from '@/src/store/authStore';
import { withTimeout } from '@/src/utils/withTimeout';
import { withNetworkTimeout } from './relayNetworkTimeout';
import {
  forceClearPersistedSession, leerDuenoDeSesion, encolarOperacionDeSesion,
} from './relaySessionStorage';

/**
 * Sesión de Supabase del BUZÓN.
 *
 * **T-147-b (2026-09-27, `engram/plans/T-147.md`, sellado por el PO)
 * ENMIENDA a la SIMPLIFICACIÓN del mismo día:** el captcha vuelve a ser
 * SÓLO PARA INVITADOS (P-3 original) — verificado contra producción,
 * `grant_type=id_token` sin captcha rechaza con «Bad ID token» (no aplica a
 * cuentas) y el signup anónimo sin captcha rechaza con `captcha_failed` (sí
 * aplica a invitados). Dos caminos, no uno:
 *
 *  - **Cuenta (Google/Apple):** el buzón usa la sesión de CUENTA que dejó
 *    `signInWithIdToken` en el login (`directoryAuth.ts`, unificado con este
 *    mismo cliente — ya NO hay un `directoryClient.ts` aparte). Este módulo,
 *    para cuentas, SÓLO LEE esa sesión — nunca `signInAnonymously`, nunca
 *    pide captcha. La reconexión (Google silencioso, Apple interactivo, el
 *    rechazo de "otra cuenta") vive enteramente en `app/auth/verify.tsx`.
 *  - **Invitado:** sin cambios — sesión ANÓNIMA con Turnstile, una por
 *    instalación (el buzón, ADR-003, es tonto: no necesita saber de qué
 *    cuenta es cada sobre, sólo "un aparato real, con cuota").
 *
 * **Costo aceptado por el PO:** la cuota del INVITADO es por instalación
 * (dos sesiones de invitado en el mismo teléfono compartirían cuota si
 * volvieran a coexistir); el captcha frena la creación masiva de
 * instalaciones de invitado.
 */

// T-192: storage cifrado, marcador de dueño y la cola FIFO salieron a
// relaySessionStorage.ts. Re-exportados para que la ruta pública
// `@/src/sync/relaySession` no cambie (`relay.ts`/`directoryAuth.ts` los
// piden con `require('./relaySession')`).
export {
  supabaseAuthStorage, forceClearPersistedSession, registrarDuenoDeSesionDeCuenta,
  haySesionEnCurso, encolarOperacionDeSesion,
} from './relaySessionStorage';

/** Sólo tests. */
export function __resetRelaySession(): void {
  ultimoFallo = 0;
  enCurso = null;
}

/**
 * Cierra la sesión LOCAL (auth-js + storage) sin importar si la red
 * responde.
 *
 * **T-175:** `signOut({ scope: 'local' })` sigue haciendo el viaje de red
 * (ver comentario de `forceClearPersistedSession` arriba) — sin tope, un
 * logout colgado bloqueaba esta MISMA cola (la comparte con
 * `ensureRelaySession`/`encolarOperacionDeSesion`) para siempre:
 * `reabrirSesionAnonima` (llamada por
 * `reiniciarSyncPorCambioDeCuenta` en cada cambio de cuenta) nunca
 * terminaba, y la cuenta B que entraba después se quedaba sin poder leer su
 * propia sesión. Se reusa `withTimeout` (T-138-bis) con la MISMA
 * `SESSION_TIMEOUT_MS` — al vencer, `forceClearPersistedSession()` de abajo
 * corre igual: no hace falta que la red haya contestado para vaciar el
 * bucket a mano.
 *
 * **Tope EFECTIVO real, para quien mida esto en campo:** no son
 * `SESSION_TIMEOUT_MS` (20s), son ~40s. Este `withTimeout` corta el
 * `signOut` a los 20s, pero la llamada que lo encadena (p.ej. la rama
 * anónima residual de `hacerEnsureSinCola`, `await purgarSesionLocal(...)`
 * seguido de un `getSession()` en la vuelta siguiente) puede quedar
 * ESPERANDO A auth-js internamente otros ~20s más si esa `getSession()`
 * cae detrás de un `signOut` que auth-js todavía no terminó de procesar
 * (medido en test con `GoTrueClient` real; el mecanismo interno de
 * auth-js que produce esa espera NO está confirmado — 2.109 corre sin lock
 * salvo que se le pase uno). Dos topes de 20s en cadena, no uno.
 */
async function purgarSesionLocal(supabase: ClienteAuth): Promise<void> {
  await withTimeout(
    supabase.auth.signOut({ scope: 'local' }).then(() => undefined, () => undefined),
    SESSION_TIMEOUT_MS,
    undefined,
  );
  forceClearPersistedSession();
}

/** `'identity'` (T-147-b, cuenta) se suma a los dos que ya había. */
export type SessionKind = 'identity' | 'anonymous' | 'none';

/** `true` sólo para Google/Apple — nunca para invitado ni sin usuario. */
function esCuenta(provider: string | undefined): boolean {
  return provider === 'google' || provider === 'apple';
}

/** Tras un fallo (captcha o Auth), cuánto esperar antes de reintentar en vez de
 *  pedir un token nuevo en cada llamada — un servidor caído no debe convertirse
 *  en un captcha resuelto por segundo. */
export const SESSION_RETRY_MS = 120_000;

let ultimoFallo = 0;
let enCurso: Promise<SessionKind> | null = null;

/**
 * Cuánto se espera, como máximo, a que la sesión quede lista. Vencido, se
 * resuelve a `'none'`: la próxima vuelta (poll o reinicio) lo vuelve a
 * intentar solo.
 */
export const SESSION_TIMEOUT_MS = 20_000;

async function abrirSesion(permitirCaptcha: boolean): Promise<SessionKind> {
  if (!permitirCaptcha) return 'none';
  const supabase = getRelayClient();
  if (!supabase) return 'none';

  const captcha = await requestCaptchaToken();
  if (captcha.status === 'failed') {
    ultimoFallo = Date.now();
    return 'none';
  }

  const opciones = captcha.status === 'ok'
    ? { options: { captchaToken: captcha.token } }
    : undefined;

  const { data, error } = opciones
    ? await supabase.auth.signInAnonymously(opciones)
    : await supabase.auth.signInAnonymously();

  if (error || !data?.session) {
    ultimoFallo = Date.now();
    return 'none';
  }
  return 'anonymous';
}

/**
 * Garantiza que haya una sesión ANÓNIMA del buzón antes de tocar el buzón.
 *
 * Single-flight: dos llamadas concurrentes comparten la misma promesa, así que
 * un `startRelay` y un poll que coinciden no abren dos sesiones anónimas.
 *
 * Sin tope, una red que nunca contesta dejaría `enCurso` colgado para
 * siempre — y como es compartida, CADA lectura futura heredaría la misma
 * promesa colgada. El tope vive DENTRO de `hacerEnsure` (`withNetworkTimeout`,
 * ver abajo): al vencer, `enCurso` se resuelve (a `'none'`) y se libera, así
 * que la vuelta siguiente puede reintentar sola. Ya no hace falta un segundo
 * `withTimeout` acá afuera — duplicaría el mismo tope y, peor, uno que NO
 * sabe pausarse durante la espera humana del captcha interactivo.
 *
 * BUG (T-147 post-merge): el cartel de captcha aparecía "en cualquier
 * momento" porque el reintento de fondo (poll de `relayEngine`) llamaba a
 * esta misma función sin distinguirse de la entrada real. `permitirCaptcha`
 * (default `true`, para no romper a quien ya la llamaba así desde la
 * entrada) es el freno: en `false`, si no hay sesión no se intenta abrir
 * ninguna — nunca se pide un token, nunca se muestra nada. El aviso
 * `SinSesionDeSync` ya existente es quien avisa en pantalla, no un modal.
 *
 * `opciones.ignorarCooldown` (fix "Reintentar no funciona" — evidencia de
 * campo del PO): `SESSION_RETRY_MS` frena el REINTENTO DE FONDO después de
 * un fallo, para no golpear el servidor una vez por poll. Un "Reintentar"
 * tocado a mano en `verify.tsx` no es ese reintento de fondo — es la persona
 * pidiendo, explícitamente, que se lo intente DE NUEVO ya — así que ignora
 * ese cooldown en vez de comerse el toque en silencio.
 */
export function ensureRelaySession(
  permitirCaptcha: boolean = true,
  opciones?: { ignorarCooldown?: boolean },
): Promise<SessionKind> {
  if (enCurso) return enCurso;
  const promesa = hacerEnsure(permitirCaptcha, opciones?.ignorarCooldown ?? false);
  enCurso = promesa.finally(() => { enCurso = null; });
  return enCurso;
}

/**
 * El tope de tiempo va DENTRO de la cola (envolviendo la función que se
 * encola, no la promesa ya encolada): si quedara afuera, un `signInAnonymously`
 * colgado seguiría bloqueando la cola para siempre aunque ESTA llamada se
 * rindiera a los `SESSION_TIMEOUT_MS`.
 */
function hacerEnsure(permitirCaptcha: boolean, ignorarCooldown: boolean): Promise<SessionKind> {
  return encolarOperacionDeSesion(() => withNetworkTimeout(
    () => hacerEnsureSinCola(permitirCaptcha, ignorarCooldown), SESSION_TIMEOUT_MS, 'none' as SessionKind,
  ));
}

/**
 * T-147 (fila 9c/9e de la retro, decisión del PO 2026-09-27): chequeo PURO
 * — nunca abre nada, nunca pide captcha, nunca purga un residuo — para que
 * la hidratación inicial pueda decidir SIN efectos secundarios si hace
 * falta bloquear el paso a tabs con la pantalla de verificación (9c: no hay
 * sesión del buzón) o si ya la tiene (9e: arranque en frío con sesión
 * persistida — la pantalla no debe aparecer nunca).
 *
 * **T-147-b (fila 11 de la tabla nueva):** "sesión persistida" ahora
 * significa cosas distintas según quién sea — para una CUENTA es una sesión
 * CON identidad (`is_anonymous: false`); para un invitado, sigue siendo la
 * anónima de siempre. El nombre quedó de la versión vieja (sólo invitados);
 * la firma no cambió porque nadie de afuera necesita saber cuál de las dos
 * validó.
 *
 * Un error de `getSession()` (refresh transitorio) se trata como "no
 * validada": es preferible mostrar la verificación de más (peor caso, un
 * paso extra) que saltarla sobre un estado incierto.
 *
 * **T-175: para CUENTA no alcanza con `!is_anonymous`.** Antes de este fix,
 * una sesión de cuenta persistida
 * pero SIN el marcador de dueño (`DUENO_KEY` — p.ej. instalación de un
 * build previo a B2, o cualquier residuo que `ensureRelaySession` todavía
 * no llegó a purgar) hacía que este chequeo devolviera `true`: el gate de
 * arranque (`src/store/session.ts:182-188`) daba por buena la sesión y
 * dejaba pasar SIN mostrar `verify.tsx` — pero el siguiente
 * `ensureRelaySession` (rama cuenta, `:438-440`) SÍ exige el marcador, lo
 * encuentra ausente, purga y devuelve `'none'`. Resultado reproducido:
 * gate en `true`, `ensureRelaySession` en `'none'`, sin sesión — y como
 * `verify.tsx` nunca se mostró, ni el silencioso de Google ni el botón de
 * Apple llegan a correr para arreglarlo solos.
 *
 * Se compara contra el MISMO marcador que usa `ensureRelaySession`
 * (`leerDuenoDeSesion`) — lectura PURA, sin `purgarSesionLocal`: esta
 * función sigue prometiendo "nunca purga un residuo" (fila 9c/9e de
 * arriba); el residuo lo limpia `ensureRelaySession` cuando corra de
 * verdad, no este chequeo de sólo-lectura.
 */
export async function haySesionAnonimaValida(): Promise<boolean> {
  const supabase = getRelayClient();
  if (!supabase) return true; // relay no configurado: nada que verificar
  const { data, error } = await supabase.auth.getSession();
  if (error) return false;
  if (!data.session) return false;

  if (esCuenta(useAuthStore.getState().currentUser?.authProvider)) {
    if (data.session.user.is_anonymous) return false;
    const marcador = leerDuenoDeSesion();
    const uidActivo = useAuthStore.getState().currentUser?.id;
    return marcador?.cuenta === uidActivo && marcador?.sesion === data.session.user.id;
  }

  return Boolean(data.session.user.is_anonymous);
}

async function hacerEnsureSinCola(permitirCaptcha: boolean, ignorarCooldown: boolean): Promise<SessionKind> {
  const supabase = getRelayClient();
  if (!supabase) return 'none';

  const cuenta = esCuenta(useAuthStore.getState().currentUser?.authProvider);

  if (cuenta) {
    // T-147-b: una CUENTA sólo LEE acá. Nunca `signInAnonymously`, nunca
    // pide captcha — eso lo prohibía "Bad ID token" contra producción para
    // el login de cuenta, y la reconexión (Google silencioso / Apple
    // interactivo / rechazo de otra cuenta) vive enteramente en
    // `verify.tsx`.
    const { data, error } = await supabase.auth.getSession();
    if (error) return 'none';

    if (data.session?.user.is_anonymous) {
      /**
       * T-175: una cuenta puede tener una sesión ANÓNIMA residual —
       * heredada del `main` actual
       * (donde TODOS usaban anónima, sin excepción) o de un invitado→cuenta
       * a medio terminar. Nunca cuenta como `identity`, pero tampoco puede
       * quedarse guardada: si no se purga, el cliente unificado del buzón
       * (`getRelayClient()`) sigue teniendo esa sesión persistida y el
       * fondo (`relayEngine.ts`) le seguiría mandando el JWT anónimo al
       * servidor bajo el nombre de una cuenta — viola "cuenta: nunca
       * anónima". Se purga acá mismo, como el residuo de IDENTIDAD que ya
       * purgaba la rama de invitado (abajo), sólo que al revés.
       */
      await purgarSesionLocal(supabase);
      return 'none';
    }

    if (!data.session) return 'none';

    /**
     * T-175: defensa general — la sesión guardada puede no ser de la cuenta
     * activa. Pasa por ejemplo cuando un
     * login de A vence acá (`SESSION_TIMEOUT_MS`) pero auth-js la deja
     * persistida IGUAL cuando la respuesta de red llega tarde
     * (`_saveSession` no sabe de nuestro tope) — si para entonces ya entró
     * B, `getSession()` le devolvería el JWT de A disfrazado de
     * `'identity'`. Se compara contra `DUENO_KEY` (ver el docblock de
     * `registrarDuenoDeSesionDeCuenta` arriba — no `esYo`, y por qué) en
     * vez de confiar ciegamente en `is_anonymous: false`.
     *
     * No alcanza con que la CUENTA coincida — hace falta que el marcador
     * haya confirmado ESTA sesión puntual
     * (`data.session.user.id`). Si sólo se comparara la cuenta, B logueado
     * de verdad (marcador = B) seguido de una sesión de OTRO `user.id`
     * pisando el storage (p.ej. A, llegada tarde, sin pasar por el purgado
     * de B2i) pasaría igual — `currentUser` sigue siendo B, así que
     * "cuenta == cuenta" da TRUE aunque la SESIÓN sea ajena.
     *
     * Si no coincide (o nunca se registró), se purga — nunca se deja un
     * JWT ajeno persistido — y `verify.tsx` reconecta desde cero, igual que
     * si nunca hubiera sesión.
     */
    const marcador = leerDuenoDeSesion();
    const uidActivo = useAuthStore.getState().currentUser?.id;
    if (!marcador || marcador.cuenta !== uidActivo || marcador.sesion !== data.session.user.id) {
      await purgarSesionLocal(supabase);
      return 'none';
    }

    return 'identity';
  }

  const { data, error } = await supabase.auth.getSession();

  if (data.session) {
    // Con la sesión anónima única (SIMPLIFICACIÓN), lo único que puede estar
    // guardado que NO sirva es un residuo de identidad de una instalación
    // que corría con el diseño viejo (T-147, antes de esta simplificación):
    // se purga y se abre una anónima limpia, en vez de arrastrar un JWT de
    // cuenta que el buzón ya no debe usar nunca.
    if (data.session.user.is_anonymous) return 'anonymous';
    await purgarSesionLocal(supabase);
    // sigue abajo: sin sesión, abre una anónima nueva.
  } else if (error) {
    /**
     * Un error acá significa que el refresh del token FALLÓ —red caída al
     * volver de background, servidor de Auth caído— no que "no hay sesión".
     * `auth-js` no borra el refresh token del storage ante un fallo
     * reintentable: la sesión anónima sigue ahí, sólo que esta consulta no
     * la pudo confirmar. Tratar esto igual que "nunca hubo sesión" abriría
     * una anónima ENCIMA de una todavía válida.
     */
    ultimoFallo = Date.now();
    return 'none';
  }

  if (!ignorarCooldown && ultimoFallo && Date.now() - ultimoFallo < SESSION_RETRY_MS) return 'none';

  // Acá SÍ es seguro abrir una anónima: `getSession()` contestó sin error y
  // sin sesión (primer arranque, logout explícito que borró el storage, o el
  // residuo de identidad de arriba que se acaba de purgar).
  return abrirSesion(permitirCaptcha);
}

type ClienteAuth = NonNullable<ReturnType<typeof getRelayClient>>;

/**
 * Cambio de cuenta / logout: la sesión del buzón (sea de identidad o
 * anónima) se cierra y se fuerza el borrado de su storage, para que la
 * PRÓXIMA `ensureRelaySession()` decida desde cero según quién sea el
 * usuario nuevo (T-147-b: invitado → anónima con captcha; cuenta → nada
 * hasta que `verify.tsx` reconecte).
 *
 * El nombre quedó de la SIMPLIFICACIÓN (cuando la única sesión posible era
 * la anónima); sigue siendo el gesto correcto para las DOS ramas de
 * T-147-b — purgar y dejar que el próximo `ensureRelaySession` reabra lo que
 * corresponda — así que no hizo falta tocar la lógica, sólo este
 * comentario. Es el cinturón de seguridad que el PO pidió: ningún trabajo
 * diferido de la cuenta anterior puede seguir saliendo con la sesión que ya
 * estaba abierta cuando se encoló, porque esa sesión deja de existir. Pasa
 * por la MISMA cola que `ensureRelaySession` para que un `ensure` que ya
 * estaba en vuelo no se pise con este reinicio.
 */
export function reabrirSesionAnonima(): Promise<void> {
  return encolarOperacionDeSesion(async () => {
    const supabase = getRelayClient();
    if (supabase) await purgarSesionLocal(supabase);
    else forceClearPersistedSession();
  });
}

/**
 * Ata el auto-refresh del token al ciclo de vida de la app — patrón oficial de
 * Supabase para React Native: en background el refresco periódico no tiene
 * sentido (no hay red garantizada, y gasta batería) y `autoRefreshToken: true`
 * a secas no sabe distinguir primer plano de fondo.
 */
export function bindAuthRefreshToAppState(): () => void {
  const supabase = getRelayClient();

  // Sin este arranque explícito, un arranque en frío (la app ya está
  // `active` desde antes de que esto se suscriba) nunca dispararía el
  // primer evento `change`, y el refresco automático no se prendería hasta
  // el primer viaje a background y de vuelta.
  if (supabase) supabase.auth.startAutoRefresh();

  const sub = AppState.addEventListener('change', estado => {
    if (!supabase) return;
    if (estado === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  return () => sub.remove();
}
