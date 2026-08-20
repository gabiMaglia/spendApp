import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * La hora, corregida contra el reloj del relay (ADR-005).
 *
 * Todo el merge del proyecto es Last-Write-Wins por `updatedAt`. Mientras
 * `updatedAt` salga de `Date.now()`, **un teléfono con la hora adelantada gana
 * TODOS los conflictos** hasta que el tiempo real lo alcance: si alguien lo
 * tiene en 2030, sus versiones pisan las de los demás durante años y nadie ve un
 * error — las ediciones de los otros simplemente "no se guardan".
 *
 * La corrección se apoya en algo que ya teníamos gratis: el relay estampa la
 * hora del servidor al insertar cada sobre, y esa hora vuelve en la respuesta.
 * Es un reloj único para todos los dispositivos.
 *
 * **Lo que esto NO hace, y conviene tenerlo presente:** no da causalidad. Dos
 * personas editando el mismo gasto sin haberse sincronizado se siguen
 * resolviendo por timestamp. Para una app de gastos entre pocos, que además
 * sincronizan cada 20 segundos, es lo que uno espera; para edición colaborativa
 * fina haría falta un reloj lógico (ADR-005, opción A).
 *
 * El desfase es del APARATO, no de la cuenta: no se scopea.
 */

const storage = createSecureStorage('groupkeys');
const KEY = 'clock_offset_v1';

/** A partir de acá el desfase deja de ser ruido de red y es un reloj mal puesto. */
export const SKEW_WARN_MS = 5 * 60 * 1000;

/**
 * Guarda el desfase a partir de una hora del servidor.
 *
 * `localAtRequest` es la hora local tomada ANTES de la llamada: usar la de
 * después metería la latencia dentro del desfase. Es una aproximación —el
 * servidor estampa en algún punto entre el pedido y la respuesta— pero el error
 * es de milisegundos, y lo que se está corrigiendo son horas o años.
 */
export function recordServerTime(serverIso: string, localAtRequest: number): void {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server)) return; // fecha ilegible: se ignora, no se rompe

  storage.set(KEY, String(server - localAtRequest));
}

/** Desfase conocido, en ms. 0 si nunca hablamos con el relay. */
export function clockOffsetMs(): number {
  const raw = storage.getString(KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** ¿Ya tenemos una referencia real, o estamos usando el reloj del teléfono? */
export function hasClockReference(): boolean {
  return storage.getString(KEY) !== undefined;
}

/**
 * La hora para estampar en `updatedAt`. Reemplaza a `Date.now()` en TODO punto
 * que decida un conflicto de merge.
 *
 * Sin referencia devuelve la hora local: es exactamente lo que había antes, así
 * que un dispositivo que nunca habló con el relay no queda peor que hoy.
 */
export function syncedNow(): number {
  return Date.now() + clockOffsetMs();
}

/**
 * ¿El reloj del teléfono está mal por un margen que el usuario debería saber?
 *
 * Corregir `updatedAt` en silencio arregla el merge, pero NO arregla lo que el
 * usuario ve: un teléfono con la hora mal muestra fechas de gastos equivocadas,
 * y eso ningún desfase lo corrige. Por eso además de corregir, se puede avisar.
 */
export function clockIsOff(): boolean {
  // Sin referencia el desfase es 0, así que el umbral ya descarta ese caso solo.
  // Agregar `hasClockReference()` acá sería una condición que ningún test puede
  // distinguir de su ausencia.
  return Math.abs(clockOffsetMs()) > SKEW_WARN_MS;
}

/** Sólo para tests y para el borrado de dispositivo. */
export function clearClockOffset(): void {
  storage.delete(KEY);
}
