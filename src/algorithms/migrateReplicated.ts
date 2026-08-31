import type { Expense, PersonalEntry } from '@/src/types/models';

/**
 * Migración one-shot de las réplicas de gastos de grupo (ADR-006, decisión 3).
 *
 * Hasta hoy, un gasto de grupo replicaba **mi porción** como movimiento
 * personal. El ADR define que el gasto propio es **la plata que salió de mi
 * bolsillo**, así que esa réplica está mal en los dos sentidos:
 *
 * - **Pagué yo**: puse el total, no mi porción. La réplica valía de menos.
 * - **Pagó otro**: no salió plata mía. Es una DEUDA, no un gasto; se vuelve
 *   gasto recién cuando la salde. La réplica no debería existir.
 *
 * Devuelve un PLAN en vez de escribir: así se puede mostrar qué va a pasar
 * antes de tocar datos del usuario, y se puede testear sin stores.
 */
export type PlanMigracion = {
  /** Réplicas que pasan a valer lo que realmente se pagó. */
  actualizar: { id: string; amount: number }[];
  /** Réplicas que representaban una deuda ajena y no un gasto propio. */
  borrar: string[];
  /**
   * Réplicas cuyo gasto de origen ya no está.
   *
   * **No se tocan.** Sin el gasto no hay con qué decidir si la pagué yo, y
   * borrarlas destruiría el único rastro que queda de algo que pasó de verdad.
   * Se cuentan para poder informarlas.
   */
  huerfanas: number;
};

export function planMigracionReplicados(
  entries: PersonalEntry[],
  expenses: Expense[],
  me: string,
): PlanMigracion {
  const plan: PlanMigracion = { actualizar: [], borrar: [], huerfanas: 0 };
  // Incluye los borrados a propósito: un gasto puede estar borrado y su
  // réplica seguir siendo historia real del mes en que ocurrió.
  const porId = new Map(expenses.map(e => [e.id, e]));

  for (const entry of entries) {
    if (entry.kind !== 'group_replicated' || entry.isDeleted) continue;

    const origen = entry.sourceGroupExpenseId ? porId.get(entry.sourceGroupExpenseId) : undefined;
    if (!origen) { plan.huerfanas++; continue; }

    if (origen.paidById === me) {
      if (entry.amount !== origen.amount) plan.actualizar.push({ id: entry.id, amount: origen.amount });
    } else {
      plan.borrar.push(entry.id);
    }
  }

  return plan;
}

/** ¿El plan cambia algo? Sirve para no molestar al usuario si no hay nada que hacer. */
export function planTieneCambios(plan: PlanMigracion): boolean {
  return plan.actualizar.length > 0 || plan.borrar.length > 0;
}
