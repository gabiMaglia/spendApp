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
   * salteó. `miembros` (T-262): alguien del reparto ya no está en el grupo y se
   * repartió en partes iguales entre los vigentes. `omitido` (T-262): no se
   * materializó (el pagador ya no está o no queda nadie con quien repartir) y
   * la plantilla NO avanza. En ningún caso se corta el arranque; el llamador
   * las anota.
   */
  problems: Array<{ id: string; kind: 'degradado' | 'fallo' | 'miembros' | 'omitido'; message: string }>;
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

/** Miembros vigentes por grupo (`Group.memberIds`). Un grupo ausente no se filtra. */
export type Rosters = Record<string, string[]>;

/**
 * T-262: una plantilla congela `memberIds`/pagadores al crearse; si después
 * alguien salió o fue expulsado, repartir con él deja una parte que ningún
 * balance cobra (deuda fantasma) o un pagador que ya no se puede saldar.
 * Decisión conservadora: se reparte sólo entre los vigentes (en partes iguales
 * si el reparto original no lo era, porque % y montos a medida dejan de
 * sumar); si el pagador ya no está o no queda nadie, no se materializa.
 */
function ajustarAlRoster(t: RecurringExpense, roster: string[]):
  { t: RecurringExpense; recortada: boolean } | { omitir: string } {
  const vigentes = new Set(roster);
  const pagadores = t.payers && t.payers.length > 0 ? t.payers.map(p => p.userId) : [t.paidById];
  if (pagadores.some(id => !vigentes.has(id))) return { omitir: 'recurrente omitida: el pagador ya no está en el grupo' };
  const memberIds = t.memberIds.filter(id => vigentes.has(id));
  if (memberIds.length === 0) return { omitir: 'recurrente omitida: ningún participante sigue en el grupo' };
  if (memberIds.length === t.memberIds.length) return { t, recortada: false };
  return { t: { ...t, memberIds, splitMode: 'equal', splitValues: undefined }, recortada: true };
}

export function materializeRecurring(
  templates: RecurringExpense[],
  now: number,
  rosters?: Rosters,
): MaterializeResult {
  const expenses: Expense[] = [];
  const personalEntries: PersonalEntry[] = [];
  const updatedTemplates: MaterializeResult['updatedTemplates'] = [];
  const problems: MaterializeResult['problems'] = [];

  for (const t of templates) {
    if (t.isDeleted || !t.isActive) continue;

    // Una plantilla corrupta no puede llevarse puestas a las demás ni el arranque.
    try {
      let plantilla = t;
      let recortada = false;
      const roster = t.groupId === '' ? undefined : rosters?.[t.groupId];
      if (roster) {
        const aj = ajustarAlRoster(t, roster);
        if ('omitir' in aj) {
          // Sólo se anota si había algo vencido; no avanza, así no se pierde.
          if (dueOccurrences(t.rule, t.lastMaterializedAt, now).length > 0) {
            problems.push({ id: t.id, kind: 'omitido', message: aj.omitir });
          }
          continue;
        }
        plantilla = aj.t;
        recortada = aj.recortada;
      }
      const r = materializeOne(plantilla, now);
      if (!r) continue;
      if (recortada) {
        problems.push({ id: t.id, kind: 'miembros', message: 'recurrente repartida sólo entre los miembros que siguen en el grupo' });
      }
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
