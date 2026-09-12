import type { Expense, Group, Payment } from '@/src/types/models';
import { expensePayers } from '@/src/algorithms/payers';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { idCanonico, mismaPersona } from '@/src/store/identityAlias';

/**
 * **Los contactos con los que tengo historial económico** (pedido del PO, 2026-09-12).
 *
 * La lista de Contactos decía «Saldado» con cualquier saldo en cero, y un contacto
 * recién agregado por QR aparecía «al día» de cuentas que nunca existieron. «Saldado»
 * sólo dice algo si HUBO cuentas: esta función decide eso.
 *
 * Hay historial con alguien si, en un grupo que cuenta para el saldo, existe:
 *  - un gasto no borrado donde participamos los dos (como pagadores o en la división), o
 *  - un saldado no borrado entre nosotros dos que cuente para el balance.
 *
 * ⚠️ **Las reglas de qué grupo y qué pago cuentan son las de `useGlobalPersonBalances`,
 * a propósito.** Si divergieran, una fila podría decir «Saldado» por un grupo cuyo saldo
 * no aparece en ningún lado. Por eso los pagos pasan por `pagosQueCuentan` y no por un
 * filtro propio: un saldado rechazado nunca ocurrió.
 *
 * Devuelve ids **canónicos** (T-048): el llamador compara con `idCanonico(contacto.id)`.
 */
export function contactosConHistorial(
  yoId: string,
  groups: readonly Group[],
  expenses: readonly Expense[],
  payments: readonly Payment[],
): Set<string> {
  const conHistorial = new Set<string>();
  const esYo = (id: string) => mismaPersona(id, yoId);

  const cuentan = new Map<string, Group>();
  for (const g of groups) {
    if (g.isDeleted) continue;
    if (!g.memberIds.some(esYo)) continue;
    cuentan.set(g.id, g);
  }

  for (const e of expenses) {
    if (e.isDeleted || !cuentan.has(e.groupId)) continue;
    const participantes = [
      ...expensePayers(e).map(p => p.userId),
      ...e.splits.map(s => s.userId),
    ];
    if (!participantes.some(esYo)) continue;
    for (const id of participantes) {
      if (!esYo(id)) conHistorial.add(idCanonico(id));
    }
  }

  for (const g of cuentan.values()) {
    for (const p of pagosQueCuentan(payments, g)) {
      if (p.isDeleted) continue;
      if (esYo(p.fromUserId) && !esYo(p.toUserId)) conHistorial.add(idCanonico(p.toUserId));
      if (esYo(p.toUserId) && !esYo(p.fromUserId)) conHistorial.add(idCanonico(p.fromUserId));
    }
  }

  return conHistorial;
}
