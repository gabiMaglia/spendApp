import type { PersonalEntry } from '@/src/types/models';

/**
 * Cómo se clasifica un movimiento personal del mes. **Una sola vez, para todas
 * las pantallas.**
 *
 * Existe por un bug que reportó el PO probando en device: en el dashboard, el
 * sobrante del mes anterior aparecía como **gastado**. La causa era que cada
 * pantalla clasificaba por su cuenta y con criterios distintos — Personal
 * separaba el carryover por signo, y el dashboard usaba `kind !== 'income'`,
 * que barre TODO lo que no sea un ingreso, carryover positivo incluido.
 *
 * El sobrante del mes pasado se contaba **dos veces mal**: sumaba a lo gastado,
 * y además no se acreditaba en lo disponible. Alguien que venía de un mes
 * ahorrativo veía el ahorro como gasto.
 *
 * `kind !== 'income'` es la forma peligrosa de escribirlo: define por descarte,
 * así que cada `kind` nuevo entra solo del lado equivocado y en silencio. Acá se
 * enumera, y un `kind` sin clasificar rompe la compilación.
 */
export type BucketPersonal = 'income' | 'expense' | 'group' | 'carryPos' | 'carryNeg';

export function bucketDe(e: PersonalEntry): BucketPersonal {
  switch (e.kind) {
    case 'income':            return 'income';
    case 'expense':           return 'expense';
    case 'group_replicated':  return 'group';
    case 'carryover':         return e.isPositiveCarryover ? 'carryPos' : 'carryNeg';
  }
}

/** Los movimientos del mes, repartidos en sus cinco baldes. */
export function repartirDelMes(
  entries: readonly PersonalEntry[],
): Record<BucketPersonal, PersonalEntry[]> {
  const out: Record<BucketPersonal, PersonalEntry[]> = {
    income: [], expense: [], group: [], carryPos: [], carryNeg: [],
  };
  for (const e of entries) out[bucketDe(e)].push(e);
  return out;
}

/**
 * **Qué cuenta como GASTADO**: lo que salió del bolsillo (ADR-006) más el
 * arrastre NEGATIVO del mes pasado, que es deuda que se trae.
 *
 * El carryover POSITIVO no está acá a propósito: es plata que sobró, y va del
 * lado del presupuesto.
 */
export const BALDES_GASTADOS: readonly BucketPersonal[] = ['expense', 'group', 'carryNeg'];

/**
 * **Qué SUMA al presupuesto disponible**: los ingresos del mes y el arrastre
 * POSITIVO.
 */
export const BALDES_DISPONIBLES: readonly BucketPersonal[] = ['income', 'carryPos'];
