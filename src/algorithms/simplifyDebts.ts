import type { Balance, Transaction } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Algoritmo Greedy para minimizar el número de transacciones en un grupo.
 * 1. Separa en Givers (balance < 0) y Receivers (balance > 0).
 * 2. Empareja el mayor Giver con el mayor Receiver.
 * 3. Repite hasta que todos los balances sean 0.
 *
 * No garantiza el óptimo global (NP-duro) pero es práctico para grupos pequeños.
 */
export function simplifyDebts(balances: Balance[], currency: CurrencyCode): Transaction[] {
  const transactions: Transaction[] = [];

  const givers = balances
    .filter(b => b.amount < 0)
    .map(b => ({ userId: b.userId, amount: round2(Math.abs(b.amount)) }))
    .sort((a, b) => b.amount - a.amount);

  const receivers = balances
    .filter(b => b.amount > 0)
    .map(b => ({ userId: b.userId, amount: round2(b.amount) }))
    .sort((a, b) => b.amount - a.amount);

  let g = 0;
  let r = 0;

  while (g < givers.length && r < receivers.length) {
    const giver    = givers[g]!;
    const receiver = receivers[r]!;

    const transfer = round2(Math.min(giver.amount, receiver.amount));

    if (transfer > 0) {
      transactions.push({
        fromUserId: giver.userId,
        toUserId:   receiver.userId,
        amount:     transfer,
        currency,
      });
    }

    giver.amount    = round2(giver.amount    - transfer);
    receiver.amount = round2(receiver.amount - transfer);

    if (giver.amount    < 0.001) g++;
    if (receiver.amount < 0.001) r++;
  }

  return transactions;
}
