import { v4 as uuidv4 } from 'uuid';
import type { BalanceByCurrency, Expense, Payer, Split } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * El traspaso de un grupo (T-058, PO 2026-09-20) no copia sus gastos — arma
 * UN `Expense` por moneda presente en el balance final del grupo viejo,
 * usando el mecanismo de pagadores múltiples que ya existe (T-025): quien
 * tenía saldo a favor queda como pagador de su crédito, quien debía queda en
 * `splits` por su deuda. Es la salida de `calculateBalancesByCurrency`
 * convertida en un registro, no un cálculo nuevo.
 *
 * Nunca mezcla monedas en un mismo `Expense` (regla de negocio #7): si el
 * grupo tenía saldos abiertos en ARS y USD, salen dos `Expense` distintos.
 * Una moneda ya saldada en 0 no genera ningún registro — no hay nada que
 * trasladar.
 */
export function buildCarryOverExpenses(
  balancesByCurrency: BalanceByCurrency[],
  groupId: string,
  description: string,
  createdById: string,
): Expense[] {
  const porMoneda = new Map<CurrencyCode, { userId: string; amount: number }[]>();

  for (const b of balancesByCurrency) {
    for (const { currency, amount } of b.balances) {
      if (amount === 0) continue;
      const lista = porMoneda.get(currency) ?? [];
      lista.push({ userId: b.userId, amount });
      porMoneda.set(currency, lista);
    }
  }

  const ahora = syncedNow();
  const expenses: Expense[] = [];

  for (const [currency, entradas] of porMoneda) {
    const acreedores = entradas.filter(e => e.amount > 0);
    const deudores = entradas.filter(e => e.amount < 0);
    if (acreedores.length === 0 || deudores.length === 0) continue;

    const payers: Payer[] = acreedores.map(a => ({ userId: a.userId, amount: a.amount }));
    const splits: Split[] = deudores.map(d => ({ userId: d.userId, amount: -d.amount, isPaid: false }));
    const total = payers.reduce((s, p) => s + p.amount, 0);

    expenses.push({
      id: uuidv4(),
      groupId,
      description,
      amount: total,
      currency,
      paidById: payers[0].userId,
      payers,
      splits,
      splitMode: 'custom',
      category: 'other',
      date: ahora,
      createdAt: ahora,
      createdById,
      updatedAt: ahora,
      isDeleted: false,
      deletionVotes: [],
    });
  }

  return expenses;
}
