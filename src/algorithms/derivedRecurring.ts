import { buildSplits } from './buildSplits';
import type { Expense, RecurringExpense } from '@/src/types/models';

/**
 * **Un gasto materializado no lo firmó nadie, pero SÍ se puede atribuir**
 * (T-041 · S9 · hueco D5).
 *
 * Los gastos que salen de una plantilla recurrente los emite el primer
 * dispositivo que abre la app después del vencimiento, no el autor de la
 * plantilla. Ese dispositivo no puede firmarlos: firmarlos sería declarar
 * autoría ajena. Por eso caen en la cuarta categoría de D4, `no_firmable`, y
 * el contador que la mide no bajaba nunca.
 *
 * **La salida no es un campo nuevo que viaje: es recalcular.** Un gasto
 * materializado deriva ENTERO de la plantilla más el vencimiento — ese es
 * exactamente el contrato de `materializeRecurring`. Entonces, si:
 *
 *  1. el id promete `rec_<plantilla>_<vencimiento>`,
 *  2. todos los campos del gasto son los que la plantilla dicta en ese
 *     vencimiento, y
 *  3. la firma de la PLANTILLA verifica,
 *
 * el gasto es tan atribuible como la plantilla, y con el mismo autor. No hay
 * nada que un atacante pueda mover: cambiarle un peso al gasto rompe (2), y
 * cambiárselo a la plantilla rompe (3).
 *
 * Que no viaje nada extra importa: el sobre lleva el estado completo del grupo
 * y ya está contra el techo (T-058). Un `derivedFrom` guardado sumaría bytes
 * por gasto para decir algo que se puede deducir.
 *
 * **Este archivo no toca criptografía.** El paso (3) lo hace quien llama, con
 * la caché de veredictos. Acá viven (1) y (2), que son puras y son las que
 * pueden fallar en silencio.
 */

const PREFIJO = 'rec_';

export type OrigenRecurrente = { templateId: string; vencimiento: number };

/**
 * De qué plantilla y qué vencimiento dice venir este gasto.
 *
 * Se corta por el ÚLTIMO `_` porque el id de la plantilla puede tener guiones
 * bajos adentro y el vencimiento nunca los tiene.
 */
export function origenRecurrenteDe(expenseId: string): OrigenRecurrente | null {
  if (!expenseId.startsWith(PREFIJO)) return null;

  const corte = expenseId.lastIndexOf('_');
  if (corte < PREFIJO.length) return null;

  const vencimiento = expenseId.slice(corte + 1);
  if (!/^\d+$/.test(vencimiento)) return null;

  const templateId = expenseId.slice(PREFIJO.length, corte);
  if (!templateId) return null;

  return { templateId, vencimiento: Number(vencimiento) };
}

/**
 * ¿Este gasto es EXACTAMENTE lo que la plantilla produce en ese vencimiento?
 *
 * Se comparan los campos que la plantilla dicta, uno por uno y a propósito: un
 * `canonical()` del gasto entero metería `updatedAt`, `isDeleted` y los votos
 * de borrado, que los escriben terceros y cambian solos. Un gasto borrado
 * seguiría siendo un gasto derivado legítimo.
 *
 * `splits` se RECALCULA en vez de compararse crudo: es lo que hace que cambiar
 * el reparto sin tocar el monto no pase inadvertido.
 */
export function fielALaPlantilla(
  expense: Expense, template: RecurringExpense, vencimiento: number,
): boolean {
  if (template.id !== origenRecurrenteDe(expense.id)?.templateId) return false;
  if (template.groupId === '') return false;   // los personales no son `Expense`

  const esperado = {
    groupId:     template.groupId,
    description: template.description,
    amount:      template.amount,
    currency:    template.currency,
    paidById:    template.paidById,
    splitMode:   template.splitMode,
    category:    template.category,
    createdById: template.createdById,
    date:        vencimiento,
    createdAt:   vencimiento,
  };

  for (const [campo, valor] of Object.entries(esperado)) {
    if ((expense as unknown as Record<string, unknown>)[campo] !== valor) return false;
  }

  const splits = buildSplits(
    template.amount, template.memberIds, template.splitMode, template.splitValues,
  );
  if (expense.splits?.length !== splits.length) return false;
  for (let i = 0; i < splits.length; i++) {
    if (expense.splits[i]!.userId !== splits[i]!.userId) return false;
    if (expense.splits[i]!.amount !== splits[i]!.amount) return false;
  }

  // `payers` sólo existe cuando el gasto lo ponen entre varios.
  const a = template.payers ?? [];
  const b = expense.payers ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.userId !== b[i]!.userId || a[i]!.amount !== b[i]!.amount) return false;
  }

  return true;
}
