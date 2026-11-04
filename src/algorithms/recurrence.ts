/**
 * Motor de gastos recurrentes (alquiler, servicios, suscripciones).
 *
 * Paridad con Splitwise, donde los recurrentes son GRATIS — por eso acá también
 * van en el plan libre.
 *
 * El diseño clave es que NO hay servidor ni tarea de fondo: la app materializa
 * los gastos vencidos cuando se abre. Eso obliga a dos propiedades:
 *
 *  - **Recuperación**: si la app estuvo cerrada tres meses, al abrirla tienen que
 *    aparecer los tres gastos, no sólo el último.
 *  - **Idempotencia**: abrir la app dos veces seguidas no puede duplicar nada.
 *    Por eso `dueOccurrences` recibe el último vencimiento ya materializado y
 *    devuelve sólo lo posterior — nunca "desde hoy".
 */

import type { RecurrenceRule } from '@/src/types/models';

export type Frequency = RecurrenceRule['frequency'];
export type { RecurrenceRule };

const DAY_MS = 86_400_000;

/**
 * El calendario VISIBLE (`occurrenceAt`) es en HORA LOCAL del aparato (T-263): el día de
 * una cuota es el que el usuario vio al cargarla, no el de UTC. En UTC, un
 * alquiler cargado el 30 a las 22:00 en Argentina (ya 31 a la 01:00 UTC) caía
 * el 27 de febrero; y sumar 7×24 h fijas movía una hora cargada cerca de
 * medianoche al día vecino al cruzar un cambio de horario.
 *
 * `startDate` sigue siendo un timestamp absoluto. Ojo: un aparato en otro huso
 * ve el mismo ancla con otro día local (el calendario es del aparato).
 */

/** Último día del mes indicado (mes 0-11). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Suma `days` días de calendario conservando la hora local del ancla. */
function addDays(anchor: number, days: number): number {
  const d = new Date(anchor);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
    d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

/**
 * Suma meses conservando el día del mes cuando existe, y cayendo al último día
 * cuando no. Un alquiler que vence el 31 vence el 28 en febrero y **vuelve al
 * 31** en marzo: el ancla es siempre `startDate`, no el vencimiento anterior.
 * (Sumar mes a mes desde el anterior haría que el 31 degrade a 28 para siempre.)
 */
function addMonths(anchor: number, months: number): number {
  const d = new Date(anchor);
  const y = d.getFullYear();
  const m = d.getMonth();
  const targetMonth = m + months;
  const ty = y + Math.floor(targetMonth / 12);
  const tm = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(d.getDate(), daysInMonth(ty, tm));

  return new Date(ty, tm, day, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

/**
 * Fórmula UTC ORIGINAL de los vencimientos. Es la IDENTIDAD de la cuota: el id
 * (`rec_<plantilla>_<instante>`), el `updatedAt` derivado y `lastMaterializedAt`
 * se miden con ella. Idéntica en todo aparato, sea cual sea su huso, e idéntica
 * a los ids ya emitidos. NO tocar: cambiarla duplicaría cuotas entre aparatos.
 */
function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonthsUtc(anchor: number, months: number): number {
  const d = new Date(anchor);
  const targetMonth = d.getUTCMonth() + months;
  const ty = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const tm = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonthUtc(ty, tm));
  return Date.UTC(ty, tm, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

export function occurrenceAtUtc(rule: RecurrenceRule, n: number): number {
  switch (rule.frequency) {
    case 'weekly':      return rule.startDate + n * 7 * DAY_MS;
    case 'fortnightly': return rule.startDate + n * 14 * DAY_MS;
    case 'monthly':     return addMonthsUtc(rule.startDate, n);
    case 'yearly':      return addMonthsUtc(rule.startDate, n * 12);
  }
}

/** El n-ésimo vencimiento en hora LOCAL (lo que se muestra). n = 0 es `startDate`. */
export function occurrenceAt(rule: RecurrenceRule, n: number): number {
  switch (rule.frequency) {
    case 'weekly':      return addDays(rule.startDate, n * 7);
    case 'fortnightly': return addDays(rule.startDate, n * 14);
    case 'monthly':     return addMonths(rule.startDate, n);
    case 'yearly':      return addMonths(rule.startDate, n * 12);
  }
}

/**
 * Primer vencimiento (instante legacy, ver `occurrenceAtUtc`) estrictamente
 * posterior a `after`. `null` si la regla ya terminó.
 */
export function nextOccurrence(rule: RecurrenceRule, after: number): number | null {
  for (let n = 0; n < MAX_ITERATIONS; n++) {
    const at = occurrenceAtUtc(rule, n);
    if (at > after) {
      if (rule.endDate !== undefined && at > rule.endDate) return null;
      return at;
    }
  }
  return null;
}

/** Tope de seguridad: evita un bucle infinito si llega una regla corrupta. */
const MAX_ITERATIONS = 10_000;

export type DueSlot = {
  n: number;
  /** Instante en calendario local: la fecha que ve el usuario. */
  at: number;
  /** Instante UTC original: identidad, `updatedAt` y `lastMaterializedAt`. */
  legacy: number;
};

/**
 * Vencimientos pendientes de materializar hasta `now` inclusive. Qué ocurrencias
 * están vencidas se decide con el instante legacy, así todo aparato obtiene el
 * mismo conjunto de `n` sin importar su huso.
 *
 * @param lastMaterialized  Instante legacy del último vencimiento ya convertido
 *                          en gasto, o `null` si nunca se materializó ninguno.
 */
export function dueSlots(
  rule: RecurrenceRule,
  lastMaterialized: number | null,
  now: number,
): DueSlot[] {
  const out: DueSlot[] = [];
  const limit = rule.endDate !== undefined ? Math.min(now, rule.endDate) : now;

  for (let n = 0; n < MAX_ITERATIONS; n++) {
    const legacy = occurrenceAtUtc(rule, n);
    if (legacy > limit) break;
    if (lastMaterialized === null || legacy > lastMaterialized) out.push({ n, at: occurrenceAt(rule, n), legacy });
  }
  return out;
}

/** Igual que `dueSlots` pero sólo los instantes locales. */
export function dueOccurrences(
  rule: RecurrenceRule,
  lastMaterialized: number | null,
  now: number,
): number[] {
  return dueSlots(rule, lastMaterialized, now).map(s => s.at);
}

/** ¿La regla ya no va a producir más vencimientos? */
export function isExhausted(rule: RecurrenceRule, now: number): boolean {
  return nextOccurrence(rule, now) === null;
}
