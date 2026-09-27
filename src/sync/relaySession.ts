import { AppState } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { requestCaptchaToken, onCaptchaInteractiveChange } from './captchaBridge';
import { getRelayClient } from './relay';
import { createSerialQueue } from '@/src/utils/serialQueue';
import { useAuthStore } from '@/src/store/authStore';

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
 * FIFO propio de la sesión del buzón: una lectura (`ensureRelaySession`) y un
 * reinicio forzado (`reabrirSesionAnonima`, cambio de cuenta/logout) no
 * pueden pisarse — el segundo tiene que esperar a que el primero termine (y
 * viceversa) para que nadie mire el storage a mitad de camino.
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

/** Sólo tests. */
export function __resetRelaySession(): void {
  ultimoFallo = 0;
  enCurso = null;
}

/** Cierra la sesión LOCAL (auth-js + storage) sin importar si la red
 *  responde. */
async function purgarSesionLocal(supabase: ClienteAuth): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // sigue igual: se fuerza abajo
  }
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
 * Igual que `withTimeout`, pero el tope de RED se PAUSA mientras el widget
 * de Turnstile está en modo interactivo (BUG "no se pudo confirmar tu
 * acceso" — evidencia de campo del PO): esa espera es HUMANA, la decide la
 * persona (el propio widget tiene su aviso "atascado" + Reintentar, no hace
 * falta un segundo tope acá encima). Al salir de interactivo el tope
 * arranca de cero para lo que quede (p.ej. `signInAnonymously`).
 */
function withNetworkTimeout<T>(fn: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    let resuelto = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const desarmar = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const armar = () => {
      desarmar();
      timer = setTimeout(() => {
        if (resuelto) return;
        resuelto = true;
        desuscribir();
        resolve(fallback);
      }, ms);
    };

    const desuscribir = onCaptchaInteractiveChange(activo => {
      if (resuelto) return;
      if (activo) desarmar();
      else armar();
    });

    armar();

    fn().then(
      v => {
        if (resuelto) return;
        resuelto = true;
        desarmar();
        desuscribir();
        resolve(v);
      },
      () => {
        if (resuelto) return;
        resuelto = true;
        desarmar();
        desuscribir();
        resolve(fallback);
      },
    );
  });
}

/**
 * El tope de tiempo va DENTRO de la cola (envolviendo la función que se
 * encola, no la promesa ya encolada): si quedara afuera, un `signInAnonymously`
 * colgado seguiría bloqueando la cola para siempre aunque ESTA llamada se
 * rindiera a los `SESSION_TIMEOUT_MS`.
 */
function hacerEnsure(permitirCaptcha: boolean, ignorarCooldown: boolean): Promise<SessionKind> {
  return cola.run(() => withNetworkTimeout(
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
 */
export async function haySesionAnonimaValida(): Promise<boolean> {
  const supabase = getRelayClient();
  if (!supabase) return true; // relay no configurado: nada que verificar
  const { data, error } = await supabase.auth.getSession();
  if (error) return false;
  if (!data.session) return false;
  return esCuenta(useAuthStore.getState().currentUser?.authProvider)
    ? !data.session.user.is_anonymous
    : Boolean(data.session.user.is_anonymous);
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
    // `verify.tsx`. Una sesión ANÓNIMA residual (p.ej. invitado→cuenta
    // todavía sin terminar el login) NO cuenta como válida acá — se lee
    // 'none' y `verify.tsx` decide qué hacer, nunca este módulo solo.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.is_anonymous) return 'none';
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
  return cola.run(async () => {
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
