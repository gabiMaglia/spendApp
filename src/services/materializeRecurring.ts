import { dueOccurrences } from '@/src/algorithms/recurrence';
import { splitsDePlantilla } from '@/src/algorithms/recurringSplits';
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
  /**
   * Plantillas con problemas (T-251). `degradado`: se materializó en partes
   * iguales porque faltaba el reparto. `fallo`: no se pudo materializar y se
   * salteó. En ningún caso se corta el arranque; el llamador las anota.
   */
  problems: Array<{ id: string; kind: 'degradado' | 'fallo'; message: string }>;
};

function idFor(templateId: string, at: number): string {
  // Determinista a propósito: si dos devices materializan el mismo vencimiento
  // antes de sincronizar, generan el MISMO id y el merge LWW los colapsa en uno
  // en vez de duplicar el gasto.
  return `rec_${templateId}_${at}`;
}

/**
 * `updatedAt` de un gasto materializado: la fecha del VENCIMIENTO, no `now`.
 *
 * No es un detalle. Con `now`, un gasto borrado revivía: device A materializa
 * el alquiler de marzo y el usuario lo borra (tombstone con `updatedAt` = ahora);
 * device B, que estuvo offline y todavía no avanzó su copia de la plantilla, lo
 * regenera más tarde con un `updatedAt` MÁS NUEVO que el borrado, y el LWW hace
 * ganar al zombi. Anclando al vencimiento, toda regeneración da el mismo valor
 * y cualquier borrado posterior le gana siempre.
 */
function derivedUpdatedAt(at: number): number {
  return at;
}

export function materializeRecurring(
  templates: RecurringExpense[],
  now: number,
): MaterializeResult {
  const expenses: Expense[] = [];
  const personalEntries: PersonalEntry[] = [];
  const updatedTemplates: MaterializeResult['updatedTemplates'] = [];
  const problems: MaterializeResult['problems'] = [];

  for (const t of templates) {
    if (t.isDeleted || !t.isActive) continue;

    // Una plantilla corrupta no puede llevarse puestas a las demás ni el arranque.
    try {
      const r = materializeOne(t, now);
      if (!r) continue;
      expenses.push(...r.expenses);
      personalEntries.push(...r.personalEntries);
      updatedTemplates.push({ id: t.id, lastMaterializedAt: r.last });
      if (r.degradado) {
        problems.push({ id: t.id, kind: 'degradado', message: 'recurrente sin reparto guardado: se usaron partes iguales' });
      }
    } catch (e) {
      problems.push({ id: t.id, kind: 'fallo', message: `recurrente no materializable: ${(e as Error)?.message ?? 'error'}` });
    }
  }

  return { expenses, personalEntries, updatedTemplates, problems };
}

function materializeOne(t: RecurringExpense, now: number) {
  const expenses: Expense[] = [];
  const personalEntries: PersonalEntry[] = [];
  const due = dueOccurrences(t.rule, t.lastMaterializedAt, now);
  if (due.length === 0) return null;
  // El reparto es el mismo para todos los vencimientos: se calcula una vez.
  const reparto = t.groupId === '' ? null : splitsDePlantilla(t);

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
        updatedAt:   derivedUpdatedAt(at),
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
        payers:      t.payers,
        splitMode:   t.splitMode,
        splits:      reparto!.splits.map(sp => ({ ...sp })),
        category:    t.category,
        date:        at,
        createdAt:   at,
        createdById: t.createdById,
        updatedAt:   derivedUpdatedAt(at),
        isDeleted:   false,
      } as Expense);
    }
  }

  return { expenses, personalEntries, last: due[due.length - 1]!, degradado: reparto?.degradado ?? false };
}
