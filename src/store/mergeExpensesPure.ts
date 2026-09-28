import { mergeByIdLevels } from './mergeLevels';
import { preservarRecibo } from '@/src/sync/adaptadores/hushsplit/soloLocal';
import type { Expense } from '@/src/types/models';

/**
 * Merge puro de gastos: preserva el recibo local y resuelve por niveles.
 *
 * Vive en su propio módulo (T-149 · D1 verifier) y no adentro de
 * `expenseStore.ts` a propósito: ese store importa `relayEngine` (para
 * `schedulePublish`), que arrastra el relay, `authorHealth` y `deviceKeys`.
 * `accountLink.mergeAccounts` necesita esta función para fusionar cuentas SIN
 * arrastrar esa cadena — sólo `mergeByIdLevels` y `preservarRecibo`, que son
 * puros. `expenseStore.mergeExpenses` importa esta MISMA función; no hay una
 * segunda copia en ningún lado. Si el merge del sync cambia, la fusión cambia
 * sola.
 */
export function mergeExpensesPure(current: Expense[], incoming: Expense[], now: number): Expense[] {
  const locales = new Map(current.map(e => [e.id, e]));
  const conRecibo = incoming.map(e => preservarRecibo(e, locales.get(e.id)));
  return mergeByIdLevels('expense', current, conRecibo, now);
}
