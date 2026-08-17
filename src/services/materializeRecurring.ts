import { dueOccurrences } from '@/src/algorithms/recurrence';
import { buildSplits } from '@/src/algorithms/buildSplits';
import type { Expense, PersonalEntry, RecurringExpense } from '@/src/types/models';

/**
 * Convierte las plantillas recurrentes vencidas en gastos reales.
 *
 * Se llama al abrir la app: no hay servidor ni tarea de fondo. Es una función
 * PURA — recibe las plantillas y devuelve qué crear y cómo quedan actualizadas.
 * El llamador se encarga de persistir. Así se puede testear sin storage y sin
 * simular el arranque de la app.
 *
 * Idempotencia: cada plantilla lleva `lastMaterializedAt`, y sólo se generan
 * vencimientos posteriores. Correrlo dos veces seguidas no duplica nada.
 */

export type MaterializeResult = {
  expenses: Expense[];
  personalEntries: PersonalEntry[];
  /** Plantillas cuyo `lastMaterializedAt` avanzó. */
  updatedTemplates: Array<{ id: string; lastMaterializedAt: number }>;
};

function idFor(templateId: string, at: number): string {
  // Determinista a propósito: si dos devices materializan el mismo vencimiento
  // antes de sincronizar, generan el MISMO id y el merge LWW los colapsa en uno
  // en vez de duplicar el gasto.
  return `rec_${templateId}_${at}`;
}

export function materializeRecurring(
  templates: RecurringExpense[],
  now: number,
): MaterializeResult {
  const expenses: Expense[] = [];
  const personalEntries: PersonalEntry[] = [];
  const updatedTemplates: MaterializeResult['updatedTemplates'] = [];

  for (const t of templates) {
    if (t.isDeleted || !t.isActive) continue;

    const due = dueOccurrences(t.rule, t.lastMaterializedAt, now);
    if (due.length === 0) continue;

    for (const at of due) {
      if (t.groupId === '') {
        personalEntries.push({
          id:          idFor(t.id, at),
          kind:        'expense',
          description: t.description,
          amount:      t.amount,
          currency:    t.currency,
          category:    t.category,
          date:        at,
          createdAt:   at,
          updatedAt:   now,
          isDeleted:   false,
        } as PersonalEntry);
      } else {
        expenses.push({
          id:          idFor(t.id, at),
          groupId:     t.groupId,
          description: t.description,
          amount:      t.amount,
          currency:    t.currency,
          paidById:    t.paidById,
          splitMode:   t.splitMode,
          splits:      buildSplits(t.amount, t.memberIds, t.splitMode, t.splitValues),
          category:    t.category,
          date:        at,
          createdAt:   at,
          createdById: t.createdById,
          deletionVotes: [],
          updatedAt:   now,
          isDeleted:   false,
        } as Expense);
      }
    }

    updatedTemplates.push({ id: t.id, lastMaterializedAt: due[due.length - 1]! });
  }

  return { expenses, personalEntries, updatedTemplates };
}
