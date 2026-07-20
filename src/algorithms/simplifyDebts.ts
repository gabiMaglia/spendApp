import type { Balance, Transaction } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * Algoritmo Greedy para minimizar el número de transacciones en un grupo.
 * 1. Separa en Givers (balance < 0) y Receivers (balance > 0).
 * 2. Empareja el mayor Giver con el mayor Receiver.
 * 3. Repite hasta que todos los balances sean 0.
 *
 * No garantiza el óptimo global (NP-duro) pero es práctico para grupos pequeños.
 * Todos los montos son ENTEROS en menor unidad (ADR-002) — aritmética entera
 * pura, sin epsilon: "saldado" es `=== 0` exacto.
 */
export function simplifyDebts(balances: Balance[], currency: CurrencyCode): Transaction[] {
  const transactions: Transaction[] = [];

  const givers = balances
    .filter(b => b.amount < 0)
    .map(b => ({ userId: b.userId, amount: Math.abs(b.amount) }))
    .sort((a, b) => b.amount - a.amount);

  const receivers = balances
    .filter(b => b.amount > 0)
    .map(b => ({ userId: b.userId, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount);

  let g = 0;
  let r = 0;

  while (g < givers.length && r < receivers.length) {
    const giver    = givers[g]!;
    const receiver = receivers[r]!;

    const transfer = Math.min(giver.amount, receiver.amount);

    if (transfer > 0) {
      transactions.push({
        fromUserId: giver.userId,
        toUserId:   receiver.userId,
        amount:     transfer,
        currency,
      });
    }

    giver.amount    -= transfer;
    receiver.amount -= transfer;

    if (giver.amount    === 0) g++;
    if (receiver.amount === 0) r++;
  }

  return transactions;
}
