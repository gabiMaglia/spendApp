import { AppState } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { requestCaptchaToken } from './captchaBridge';
import { requestReconnect } from './accountReconnectBridge';
import { getRelayClient } from './relay';
import { useAuthStore } from '@/src/store/authStore';
import { withTimeout } from '@/src/utils/withTimeout';
import type { User } from '@/src/types/models';

/**
 * Sesión de Supabase SIEMPRE presente (T-147 D1/D2).
 *
 * Hasta acá el cliente se creaba con `persistSession: false`: la identidad la
 * manejaba la app, no Supabase, y `signInWithIdToken` sólo se llamaba una vez,
 * al tocar el botón de login. Al reabrir la app no había sesión y todo el
 * tráfico salía como `anon` — inclusive el de usuarios logueados. Cerrar el
 * buzón a `anon` (011b) cortaría el sync a todo el mundo, no sólo al invitado.
 *
 * La solución: la sesión se persiste, y si no hay ninguna se abre una
 * **anónima** (con Turnstile) antes de tocar el buzón. El modo invitado ES esa
 * sesión anónima (DEC-03) — no hay un camino separado.
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
 * Verifier R3-2: `supabase.auth.signOut({ scope: 'local' })` sigue haciendo un
 * viaje de red incluso para `local` (`GoTrueClient.js:_signOut`), y si ese
 * viaje falla con algo que no sea 404/401/403/sesión-ausente, auth-js
 * devuelve el error y **NUNCA** llega a `_removeSession()` — la sesión vieja
 * (anónima o de otra cuenta) queda pegada en el storage para siempre, sin
 * red o con red mala. `directoryAuth.signOutOfDirectory` usa esto como
 * último recurso cuando el signOut de verdad falla: el bucket `'sbauth'` es
 * EXCLUSIVO de la sesión de Supabase (nada más vive ahí), así que vaciarlo
 * entero es seguro y no depende de conocer la clave interna que usa auth-js.
 */
export function forceClearPersistedSession(): void {
  storage.clearAll();
}

/**
 * **Verifier R4-1(b) (ronda 4): la serialización de `directoryAuth` no
 * alcanzaba a `getSession`.** El PoC con auth-js real: durante un cambio de
 * cuenta A→B con un `signOut` lento, `getSession()` seguía devolviendo la
 * sesión de A (`anon=false`) mientras el `signOut` de A todavía estaba en
 * vuelo — auth-js 2.109 no usa lock si no se le pasa uno (`relay.ts` no lo
 * hace), así que nada impedía leerla a mitad de camino.
 *
 * La cola vive ACÁ (no en `directoryAuth`) para que TODA operación que
 * toque la sesión —leerla (`hacerEnsure`) o escribirla
 * (`signIntoDirectory`/`signOutOfDirectory`)— pase por el mismo FIFO: una
 * lectura que llega mientras un `signOut` está en vuelo espera a que
 * termine (y con él, a que el storage quede en su estado final) antes de
 * mirar nada. `directoryAuth.ts` importa esto de acá (nunca al revés, para
 * no armar un ciclo — `directoryAuth` ya importa `forceClearPersistedSession`
 * de este mismo archivo).
 */
let operacionEnCurso: Promise<unknown> = Promise.resolve();
let operacionesPendientes = 0;

export function encolarOperacionDeSesion<T>(fn: () => Promise<T>): Promise<T> {
  operacionesPendientes++;
  const siguiente = operacionEnCurso.then(fn, fn);
  // Nunca se propaga un rechazo por la cadena compartida: si `fn` tira, la
  // PRÓXIMA operación encolada tiene que poder correr igual.
  operacionEnCurso = siguiente.catch(() => undefined);
  void siguiente.finally(() => { operacionesPendientes--; }).catch(() => undefined);
  return siguiente;
}

/**
 * **Verifier R4-3 (ronda 4): aviso falso justo después de un login exitoso.**
 * `setUser` dispara `startRelay` ANTES de que `entrarAlDirectorio` llame a
 * `signIntoDirectory` (`auth/index.tsx:302-309`) — `ensureRelaySession`
 * puede leer "sin sesión" en esa ventana y reportarlo (`sessionStatus`),
 * mostrando «Reconectar» durante unos segundos con un login que en realidad
 * va a salir bien. `relayEngine` consulta esto antes de actualizar el
 * estado visible: mientras haya CUALQUIER operación de sesión en vuelo, no
 * se reporta nada (se deja el estado anterior).
 */
export function haySesionEnCurso(): boolean {
  return operacionesPendientes > 0;
}

/**
 * Verifier R4-1(a)/(c) (ronda 4): la sesión de Supabase se ATA al usuario
 * activo de la app — nunca se publica, suscribe ni registra una clave con
 * una sesión cuya identidad no sea la de `currentUser`.
 *
 * El `sub` de Google/Apple que usa `currentUser.id` no es necesariamente el
 * `uid` interno de Supabase (son sistemas distintos, y una cuenta fusionada
 * — T-042 — puede tener un `currentUser.id` que ni siquiera viene del
 * último proveedor usado). En vez de decodificar el JWT y perseguir esa
 * equivalencia, se recuerda LA PRIMERA VEZ qué `uid` de Supabase quedó
 * válido para cada `currentUser.id`, acá en el mismo storage cifrado. Un
 * `uid` distinto para el mismo usuario local — «Reconectar» con OTRA cuenta
 * de Google (R4-1a), o un residuo de otra cuenta que nunca se limpió
 * (R4-1c) — se rechaza: nunca se acepta como `identity`.
 */
const VINCULO_KEY = 'vinculo_uid_por_usuario';

function leerVinculos(): Record<string, string> {
  const raw = storage.getString(VINCULO_KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * ¿El `uid` de Supabase de la sesión actual es el que le corresponde a
 * `localUserId`? La primera vez que un usuario local tiene una sesión válida,
 * se la recuerda; de ahí en más, un `uid` distinto es "otra cuenta".
 */
function vincularOValidar(localUserId: string, uid: string): 'ok' | 'otra_cuenta' {
  const vinculos = leerVinculos();
  const existente = vinculos[localUserId];
  if (existente && existente !== uid) return 'otra_cuenta';
  if (!existente) {
    storage.set(VINCULO_KEY, JSON.stringify({ ...vinculos, [localUserId]: uid }));
  }
  return 'ok';
}

/** Sólo tests. */
export function __resetVinculos(): void {
  storage.delete(VINCULO_KEY);
}

/** Cierra la sesión LOCAL (auth-js + storage) sin importar si la red
 *  responde — mismo criterio que R3-2(a): el borrado local nunca puede
 *  depender de la red. */
async function purgarSesionLocal(supabase: ClienteAuth): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // sigue igual: se fuerza abajo
  }
  forceClearPersistedSession();
}

export type SessionKind = 'identity' | 'anonymous' | 'none';

/** Tras un fallo (captcha o Auth), cuánto esperar antes de reintentar en vez de
 *  pedir un token nuevo en cada llamada — un servidor caído no debe convertirse
 *  en un captcha resuelto por segundo. */
export const SESSION_RETRY_MS = 120_000;

let ultimoFallo = 0;
let enCurso: Promise<SessionKind> | null = null;

/**
 * Cuánto se espera, como máximo, a que la sesión quede lista (T-138-bis: el
 * resto de `relayEngine` ya sigue esta misma regla — ninguna espera de red
 * puede colgar el sync para siempre). Vencido, se resuelve a `'none'`: la
 * próxima vuelta (poll o reinicio) lo vuelve a intentar solo.
 */
export const SESSION_TIMEOUT_MS = 20_000;

/** Backoff de la reconexión de cuenta (R3-1) — mismo criterio que
 *  `SESSION_RETRY_MS`: un fallo (sin red, Auth caído) no puede convertirse en
 *  un intento de reconexión por segundo. */
export const RECONNECT_RETRY_MS = 120_000;
let ultimoFalloReconexion = 0;

/** Sólo tests. */
export function __resetRelaySession(): void {
  ultimoFallo = 0;
  ultimoFalloReconexion = 0;
  enCurso = null;
  operacionEnCurso = Promise.resolve();
  operacionesPendientes = 0;
}

async function abrirSesion(): Promise<SessionKind> {
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
 * Garantiza que haya una sesión de Supabase antes de tocar el buzón.
 *
 * Single-flight: dos llamadas concurrentes comparten la misma promesa, así que
 * un `startRelay` y un poll que coinciden no abren dos sesiones anónimas.
 *
 * **Verifier D2, ronda 2 (hallazgo hostil):** sin tope, una red que nunca
 * contesta dejaría `enCurso` colgado para siempre — y como es compartida,
 * CADA `releerTodo` futuro heredaría la misma promesa colgada, matando el
 * sync entero en silencio. `withTimeout` envuelve la promesa CACHEADA (no la
 * interna): al vencer el tope, `enCurso` se resuelve (a `'none'`) y se
 * libera, así que la vuelta siguiente puede reintentar sola.
 */
export function ensureRelaySession(): Promise<SessionKind> {
  if (enCurso) return enCurso;
  const promesa = withTimeout(hacerEnsure(), SESSION_TIMEOUT_MS, 'none' as SessionKind);
  enCurso = promesa.finally(() => { enCurso = null; });
  return enCurso;
}

/**
 * **Verifier R4-1(b): esta lectura pasa por la MISMA cola que
 * `signIntoDirectory`/`signOutOfDirectory`** (`encolarOperacionDeSesion`) —
 * si un cambio de cuenta A→B tiene un `signOut` de A todavía en vuelo, esta
 * función espera a que termine (y el storage quede en su estado final)
 * antes de mirar nada. Sin esto, el PoC del verificador mostraba
 * `getSession()` devolviendo la sesión de A mientras B ya era el usuario
 * activo — la app publicaría con el JWT equivocado.
 */
function hacerEnsure(): Promise<SessionKind> {
  // El tope de tiempo va DENTRO de la cola (envolviendo la función que se
  // encola, no la promesa ya encolada): si quedara afuera, una operación
  // colgada seguiría bloqueando `operacionEnCurso` para siempre aunque ESTA
  // llamada se rindiera a los `SESSION_TIMEOUT_MS` — cualquier operación
  // siguiente (login, logout, otra lectura) quedaría esperando detrás de un
  // colgado que nunca libera la cola.
  return encolarOperacionDeSesion(() => withTimeout(hacerEnsureSinCola(), SESSION_TIMEOUT_MS, 'none' as SessionKind));
}

async function hacerEnsureSinCola(): Promise<SessionKind> {
  const supabase = getRelayClient();
  if (!supabase) return 'none';

  const { data, error } = await supabase.auth.getSession();
  const user = useAuthStore.getState().currentUser;
  const esInvitado = user?.authProvider === 'guest';

  if (data.session) {
    const esAnonimaEnStorage = Boolean(data.session.user.is_anonymous);

    if (esAnonimaEnStorage && !esInvitado) {
      /**
       * Verifier R4-1(c): antes se "descartaba" pero NUNCA se borraba —
       * `releerTodo` seguía drenando y publicando con ese uid anónimo,
       * porque el cliente real de `auth-js` (no esta función) sigue
       * teniendo esa sesión cargada. Ahora se cierra de verdad
       * (`purgarSesionLocal`) antes de seguir de largo hacia la reconexión.
       */
      await purgarSesionLocal(supabase);
      // sigue abajo: sin sesión, intenta reconectar como corresponde.
    } else if (!esAnonimaEnStorage && !esInvitado && user) {
      /**
       * Verifier R4-1(a): «Reconectar» pudo haber elegido OTRA cuenta de
       * Google — el `idToken` que devuelve el selector no se comprueba
       * contra la cuenta activa antes de `signInWithIdToken`
       * (`accountReconnect.ts`), así que la sesión puede quedar con el uid
       * de una cuenta distinta INDEFINIDAMENTE. Acá es donde se detecta:
       * un `uid` que no coincide con el que ya se sabía de `currentUser.id`
       * se rechaza — nunca se publica con él.
       */
      const veredicto = vincularOValidar(user.id, data.session.user.id);
      if (veredicto === 'ok') return 'identity';
      await purgarSesionLocal(supabase);
      // sigue abajo: se purgó, intenta reconectar con la cuenta correcta.
    } else {
      return esAnonimaEnStorage ? 'anonymous' : 'identity';
    }
  }

  /**
   * Verifier D1: `error` acá significa que el refresh del token FALLÓ —red
   * caída al volver de background, servidor de Auth caído— no que "no hay
   * sesión". `auth-js` (2.109.0, `GoTrueClient.js:2486-2506`) no borra el
   * refresh token del storage ante un fallo reintentable: la sesión de
   * Google/Apple sigue ahí, sólo que esta consulta no la pudo confirmar.
   *
   * Tratar esto igual que "nunca hubo sesión" abriría una anónima y la
   * PERSISTIRÍA encima de una cuenta todavía válida (D1: "si hay sesión
   * guardada, se usa"). Se prefiere no tocar nada y reintentar más tarde —
   * igual que cualquier otro fallo de Auth (`SESSION_RETRY_MS`).
   */
  if (error) {
    ultimoFallo = Date.now();
    return 'none';
  }

  /**
   * **Ruling ronda 2 ("cortar de raíz, no parchear"), corregido en ronda 3
   * (R3-1): la sesión ANÓNIMA sigue existiendo SÓLO para el modo invitado
   * (DEC-03) — eso no cambia.** Lo que cambiaba en la ronda 2 era demasiado:
   * dejaba a CUALQUIER cuenta sin sesión de Supabase guardada en `'none'`
   * PARA SIEMPRE, que es el caso de todo usuario Google/Apple que actualiza
   * desde una versión anterior (corría con `persistSession: false`,
   * `bc933a9:relay.ts:86` — nunca tuvo nada que guardar). Rompía el Gherkin
   * «usuario viejo que actualiza».
   *
   * Ahora, para una cuenta: NUNCA se abre una anónima (eso sigue intacto —
   * no hay ninguna carrera posible porque ese camino no se toma), pero SÍ se
   * intenta RECONECTAR sola antes de rendirse:
   *  - Google puede reconectar en SILENCIO (`signInSilently` del SDK, vía
   *    `accountReconnectBridge` — el host real usa el SDK nativo).
   *  - Apple no tiene equivalente silencioso: `requestReconnect` devuelve
   *    `not_available` siempre en modo `'silent'`, y el aviso en pantalla
   *    ofrece un botón «Reconectar» (interactivo, ver `reconectarCuenta`).
   * Con backoff (`RECONNECT_RETRY_MS`) para no reintentar por segundo.
   */
  if (!esInvitado) {
    if (!user) return 'none'; // sin usuario activo, nada que reconectar (D5 ya evita llegar acá)
    if (ultimoFalloReconexion && Date.now() - ultimoFalloReconexion < RECONNECT_RETRY_MS) return 'none';

    const reconectado = await intentarReconexionSilenciosa(supabase, user);
    if (reconectado) return 'identity';

    ultimoFalloReconexion = Date.now();
    return 'none';
  }

  if (ultimoFallo && Date.now() - ultimoFallo < SESSION_RETRY_MS) return 'none';

  // Acá SÍ es seguro abrir una anónima: invitado, `getSession()` contestó sin
  // error y sin sesión — primer arranque, o logout explícito (`signOut`, que
  // borra el storage) — nunca un refresh que no se pudo confirmar.
  return abrirSesion();
}

type ClienteAuth = NonNullable<ReturnType<typeof getRelayClient>>;

/**
 * Intenta reconectar la cuenta SIN interacción del usuario (R3-1). Sólo
 * Google la soporta (`signInSilently` del SDK); Apple siempre devuelve
 * `not_available` en modo `'silent'` — el host (`AccountReconnectHost`) es
 * quien sabe la diferencia, acá sólo se usa el resultado.
 */
async function intentarReconexionSilenciosa(supabase: ClienteAuth, user: User): Promise<boolean> {
  if (user.authProvider !== 'google' && user.authProvider !== 'apple') return false;

  const r = await requestReconnect(user.authProvider, 'silent');
  if (r.status !== 'ok') return false;

  const { data, error } = await supabase.auth.signInWithIdToken({ provider: user.authProvider, token: r.idToken });
  if (error || !data?.session) return false;

  // R4-1: la reconexión en silencio usa la ÚNICA cuenta ya logueada en el
  // SDK nativo (no hay selector) — el mismatch es improbable, pero se
  // valida igual por las dudas (defensa en profundidad, mismo criterio que
  // la interactiva).
  return vincularOValidar(user.id, data.session.user.id) === 'ok';
}

/**
 * **Verifier R4-1(a):** validación después de una reconexión INTERACTIVA
 * (botón «Reconectar», `accountReconnect.ts`) — el selector de cuentas de
 * Google puede devolver una cuenta DISTINTA de la activa. Se llama recién
 * DESPUÉS de que `signIntoDirectory` ya escribió la sesión: si no coincide,
 * se cierra esa sesión (nunca queda pisando a la correcta) y se le avisa al
 * usuario que eligió otra cuenta en vez de aceptarla en silencio.
 */
export async function validarIdentidadReconectada(localUserId: string): Promise<'ok' | 'otra_cuenta' | 'sin_sesion'> {
  const supabase = getRelayClient();
  if (!supabase) return 'sin_sesion';

  return encolarOperacionDeSesion(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.is_anonymous) return 'sin_sesion';

    const veredicto = vincularOValidar(localUserId, data.session.user.id);
    if (veredicto === 'otra_cuenta') await purgarSesionLocal(supabase);
    return veredicto;
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

  // Verifier D1: antes sólo arrancaba en el próximo evento `change` a
  // `active`. En un arranque en frío la app YA está `active` desde antes de
  // que esto se suscriba, así que ese evento nunca llega — el refresco
  // automático no se prendía hasta el primer viaje a background y de vuelta.
  // Con `autoRefreshToken: false` en el cliente (`relay.ts`), esto es lo
  // ÚNICO que dispara el refresco: sin esta línea, un token que vence antes
  // de la primera vez que la app va a background nunca se renueva.
  if (supabase) supabase.auth.startAutoRefresh();

  const sub = AppState.addEventListener('change', estado => {
    if (!supabase) return;
    if (estado === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  return () => sub.remove();
}
