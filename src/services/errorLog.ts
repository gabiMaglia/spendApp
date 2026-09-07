import { Platform } from 'react-native';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { syncedNow } from '@/src/utils/syncedClock';
import { APP_VERSION } from '@/src/constants/version';

/**
 * **Registro local de errores** (T-078, camino (b) del plan).
 *
 * Hasta hoy, si la app se caía en el teléfono de alguien, uno se enteraba por
 * una reseña de una estrella. La alternativa obvia era un servicio de crash
 * reporting, y se descartó con su costeo escrito (`engram/plans/T-078.md §3`):
 * la política, tres páginas públicas y la descripción de la tienda afirman que
 * **no hay analítica**, y hay un test que lo hace cumplir
 * (`src/i18n/__tests__/promesasReales.test.ts`). Para una beta cerrada de cinco
 * a diez personas conocidas, pedirles el archivo por mensaje alcanza.
 *
 * **Nada sale del teléfono solo.** Esto guarda los últimos errores acá y le da
 * al usuario un botón para compartirlos si quiere, con el mismo mecanismo que
 * ya usa el respaldo. El usuario ve qué manda antes de mandarlo.
 *
 * **Qué se guarda, y qué no.** Sólo `message` y `stack`. Nunca un `Expense`, un
 * `User` ni el estado de un store: esta app tiene importes, nombres y mails en
 * memoria, y un diagnóstico que los arrastre es la fuga que el camino (a) traía
 * de regalo. Hay un guard que barre los llamadores para que siga siendo cierto
 * (`__tests__/diagnosticoSinDatos.test.ts`).
 *
 * ⚠️ **Sin scope de cuenta, a propósito**: un error del arranque ocurre antes de
 * que haya sesión, y un registro que dependiera de la cuenta activa perdería
 * justo los que más importan. Como no lleva el sufijo `::u:`, **el barrido de
 * borrado de cuenta no lo alcanza** (`accountLink.ts`, `barrerScope`): se borra
 * explícitamente en la fase 4 de T-074, junto con la identidad del aparato, que
 * es el otro dato de este mismo nivel.
 *
 * ⚠️ **Límite declarado:** el bucket cifrado no existe hasta que corre
 * `bootstrapSecureStorage()`. Un error ANTERIOR a eso se guarda en el fallback
 * en memoria — o sea que se puede ver y exportar en esa misma sesión, pero no
 * sobrevive a cerrar la app. No se resuelve escribiéndolo en claro: un stack
 * trace puede arrastrar cualquier cosa que estuviera en una variable.
 */

export type ErrorEntry = {
  /** Cuándo, con el reloj corregido si se puede leer. */
  at: number;
  message: string;
  stack?: string;
  /** `true` = tumbó la pantalla (lo capturó el `ErrorBoundary` o fue fatal). */
  fatal: boolean;
  /** Pista de dónde pasó, cuando el llamador la sabe. */
  screen?: string;
};

const storage = createSecureStorage('notices');
const KEY = 'error_log_v1';

/** Versión del formato del archivo exportado. */
export const FORMATO_DIAGNOSTICO = 1;

export const MAX_ENTRIES = 50;

/**
 * Topes por entrada. `MAX_ENTRIES` solo no acota nada: un stack de React Native
 * puede tener decenas de KB, así que 50 sin recorte podrían ser megabytes en un
 * storage que se lee entero en cada escritura. Se recorta el stack y no el
 * mensaje porque el mensaje es lo que se lee primero.
 */
const MAX_MENSAJE = 500;
const MAX_STACK = 4_000;

function recortar(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length <= max ? s : `${s.slice(0, max)}…[${s.length - max} caracteres más]`;
}

/** El reloj corregido si se puede; si lo que se rompió fue el reloj, el local. */
function ahora(): number {
  try {
    return syncedNow();
  } catch {
    return Date.now();
  }
}

function leer(): ErrorEntry[] {
  try {
    const raw = storage.getString(KEY);
    if (!raw) return [];
    const d = JSON.parse(raw) as { e?: unknown };
    return Array.isArray(d.e) ? (d.e as ErrorEntry[]) : [];
  } catch {
    // Un registro corrupto no puede tumbar la pantalla que lo muestra, ni
    // impedir que se anote el error siguiente.
    return [];
  }
}

/**
 * Anota un error. **No lanza nunca, por ninguna razón.**
 *
 * Es lo que corre cuando algo ya salió mal: si esto pudiera tirar, convertiría
 * un error contenido en uno que se lleva puesto al manejador de errores.
 */
export function recordError(e: Omit<ErrorEntry, 'at'>): void {
  try {
    const entrada: ErrorEntry = {
      at: ahora(),
      message: recortar(e.message, MAX_MENSAJE) ?? '',
      fatal: e.fatal,
    };
    const stack = recortar(e.stack, MAX_STACK);
    if (stack !== undefined) entrada.stack = stack;
    if (e.screen !== undefined) entrada.screen = e.screen;

    // Más nuevo primero: es el orden en que se lee un diagnóstico, y hace que
    // recortar el anillo sea tirar la cola.
    const lista = [entrada, ...leer()].slice(0, MAX_ENTRIES);
    storage.set(KEY, JSON.stringify({ v: FORMATO_DIAGNOSTICO, e: lista }));
  } catch {
    /* el registro de errores no puede ser una fuente de errores */
  }
}

/** Los errores anotados, del más nuevo al más viejo. */
export function listErrors(): ErrorEntry[] {
  return leer();
}

export function clearErrors(): void {
  try {
    storage.delete(KEY);
  } catch {
    /* … */
  }
}

/**
 * El archivo que el usuario comparte.
 *
 * Lleva versión de la app y plataforma porque son las dos preguntas que uno
 * hace apenas ve un stack, y ninguna de las dos dice nada de la persona.
 */
export function serializeErrorLog(): string {
  return JSON.stringify(
    {
      v: FORMATO_DIAGNOSTICO,
      app: APP_VERSION,
      platform: Platform.OS,
      exportedAt: ahora(),
      errors: leer(),
    },
    null,
    2,
  );
}

/** Nombre con fecha, como el del respaldo: dos archivos no se pisan. */
export function diagnosticoFileName(): string {
  const d = new Date(ahora());
  const p = (n: number) => String(n).padStart(2, '0');
  return `spendapp-diagnostico-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
