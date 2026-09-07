import { recordError } from './errorLog';

/**
 * **Lo que se rompe fuera de React** (T-078 · §5.3).
 *
 * El `ErrorBoundary` sólo ve errores de render. Un error adentro de un
 * `setTimeout`, de un callback nativo o de una promesa que React Native rutea
 * por acá no pasa por ningún componente: hoy se lo lleva el handler por default
 * —pantalla roja en desarrollo, nada en producción— y no queda rastro.
 *
 * **Se delega SIEMPRE en el handler anterior.** Reemplazarlo sin llamarlo
 * cambiaría el comportamiento por default de RN (incluida la pantalla roja de
 * desarrollo), y este módulo existe para observar, no para intervenir.
 *
 * **Si `ErrorUtils` no está, esto es un no-op.** Es API interna de React Native
 * y ha cambiado entre versiones; en 0.81 la define
 * `@react-native/js-polyfills/error-guard.js` como global, pero no hay ninguna
 * garantía de que siga. Un diagnóstico que tumbe el arranque por no encontrar
 * un global sería peor que no tener diagnóstico.
 *
 * **Lo que NO cubre, para no prometer de más:** una promesa rechazada sin
 * `catch` no llega necesariamente acá — RN la reporta por su propio rastreador
 * de rechazos. Lo que se captura es lo que RN rutea por `ErrorUtils`.
 */

type Handler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  setGlobalHandler?: (h: Handler) => void;
  getGlobalHandler?: () => Handler | undefined;
};

/** Idempotente: con fast refresh esto se importa muchas veces por sesión. */
let instalado = false;

function utils(): ErrorUtilsLike | undefined {
  return (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
}

export function installGlobalErrorHandler(): boolean {
  if (instalado) return true;

  const eu = utils();
  if (typeof eu?.setGlobalHandler !== 'function') return false;

  const previo = typeof eu.getGlobalHandler === 'function' ? eu.getGlobalHandler() : undefined;

  eu.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const e = error as { message?: unknown; stack?: unknown } | undefined;
    recordError({
      message: typeof e?.message === 'string' ? e.message : String(error),
      stack: typeof e?.stack === 'string' ? e.stack : undefined,
      fatal: isFatal === true,
    });

    // El handler de antes, pase lo que pase con el nuestro.
    try {
      previo?.(error, isFatal);
    } catch {
      /* … */
    }
  });

  instalado = true;
  return true;
}

/** Sólo para tests. */
export function __resetGlobalErrorHandler(): void {
  instalado = false;
}
