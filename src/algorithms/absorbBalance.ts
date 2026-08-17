import { buildSplits } from './buildSplits';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { SplitMode } from '@/src/types/models';

/**
 * Absorción del saldo de quien se va de un grupo.
 *
 * Salir con cuentas abiertas no es gratis: si alguien debe 5.000 y se va, esos
 * 5.000 los pierde alguien. Este módulo decide **quién**.
 *
 * La absorción se expresa como PAGOS, no como un concepto nuevo. Un `Payment`
 * ya mueve saldo entre dos personas, y encadenarlos hasta dejar en cero al que
 * se va es exactamente lo que hace falta. Ventaja concreta: los balances, la
 * simplificación de deudas y el sync ya saben tratar pagos — no hay que
 * enseñarles nada.
 *
 * La dirección sale del signo del saldo, y es la misma cuenta en los dos casos:
 *  - **Debe** (saldo < 0): pagos DEL que se va HACIA los que absorben ⇒ queda en
 *    cero y los otros se comen la pérdida.
 *  - **Le deben** (saldo > 0): pagos DE los que absorben HACIA el que se va ⇒
 *    queda en cero y a los otros se les perdona esa deuda.
 */

export type AbsorptionPlan = {
  fromUserId: string;
  toUserId: string;
  amount: number;      // entero en menor unidad, siempre positivo
  currency: CurrencyCode;
};

export type BalanceEntry = { currency: CurrencyCode; amount: number };

/** ¿Puede irse sin más trámite? Sólo si no debe ni le deben, en NINGUNA moneda. */
export function hasSettledUp(balances: BalanceEntry[]): boolean {
  return balances.every(b => b.amount === 0);
}

/** Monedas en las que quedó saldo abierto. */
export function unsettledCurrencies(balances: BalanceEntry[]): CurrencyCode[] {
  return balances.filter(b => b.amount !== 0).map(b => b.currency);
}

/**
 * Arma los pagos que dejan en cero al que se va, repartiendo su saldo entre los
 * que absorben.
 *
 * @param mode    'equal' reparte en partes iguales; 'percentage' y 'custom' usan
 *                `values`, igual que al crear un gasto — misma UI, misma lógica.
 * @param values  Sólo para 'percentage' (un % por absorbente) y 'custom'.
 *
 * Se apoya en `buildSplits`, así que hereda su garantía más importante: **la
 * suma da EXACTA contra el total**, con el resto de la división repartido de
 * forma determinista. Un reparto que no cierra dejaría al que se va con saldo
 * fantasma de una unidad.
 */
export function planAbsorption(
  leavingUserId: string,
  balances: BalanceEntry[],
  absorberIds: string[],
  mode: SplitMode = 'equal',
  values?: number[],
): AbsorptionPlan[] {
  if (absorberIds.length === 0) return [];

  const plans: AbsorptionPlan[] = [];

  // Cada moneda se absorbe por separado: los saldos multi-moneda NUNCA se
  // mezclan (regla de negocio #7).
  for (const { currency, amount } of balances) {
    if (amount === 0) continue;

    const debe = amount < 0;
    const total = Math.abs(amount);
    const partes = buildSplits(total, absorberIds, mode, values);

    for (const parte of partes) {
      if (parte.amount === 0) continue; // no se generan pagos vacíos
      plans.push({
        fromUserId: debe ? leavingUserId : parte.userId,
        toUserId:   debe ? parte.userId : leavingUserId,
        amount:     parte.amount,
        currency,
      });
    }
  }

  return plans;
}

/**
 * Verificación del plan: ¿deja realmente en cero al que se va?
 *
 * Existe porque un plan que no cierra es peor que no tener plan — el usuario
 * cree que saldó y le queda saldo fantasma. Se corre antes de persistir nada.
 */
export function planSettlesLeaver(
  plan: AbsorptionPlan[],
  leavingUserId: string,
  balances: BalanceEntry[],
): boolean {
  for (const { currency, amount } of balances) {
    const movido = plan
      .filter(p => p.currency === currency)
      .reduce((total, p) => {
        if (p.fromUserId === leavingUserId) return total + p.amount;
        if (p.toUserId === leavingUserId) return total - p.amount;
        return total;
      }, 0);

    if (amount + movido !== 0) return false;
  }
  return true;
}
