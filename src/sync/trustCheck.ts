import { verifiedCore } from './verdictCache';
import { verifyVote } from './voteSign';
import { authorKeysFor } from './authorKeys';
import { authorOf } from './signOnWrite';
import { derivedOriginOf } from './derivedRecords';
import type { CoreKind, CoreRecord } from './recordCore';
import type { RecordVerdict } from './recordHealth';
import type { CoreVerdict } from './recordSign';
import { fielALaPlantilla, origenRecurrenteDe } from '@/src/algorithms/derivedRecurring';
import type { DeletionVote, Expense, RecurringExpense } from '@/src/types/models';

/**
 * **El veredicto de una fila que el usuario está mirando** (T-041 · S10).
 *
 * Es el camino de la MARCA, no el de la medición. La diferencia importa y por
 * eso son dos módulos:
 *
 * | | `recordHealth.observeRecord` (S6) | esto (S10) |
 * |---|---|---|
 * | Cuándo | al mergear un delta | al mirar una fila |
 * | Cuántas veces | una por revisión de núcleo | una por firma, y la caché la saltea |
 * | Efectos | cuenta, mueve el trinquete, guarda el detalle | **ninguno sobre la medición** |
 * | Descarte por `rev` | sí, contra lo que ya teníamos | no aplica: acá el registro YA es el nuestro |
 *
 * Duplicar la clasificación en vez de reusar `observeRecord` es deliberado: si
 * la UI llamara a la medición, los contadores se moverían por mirar una
 * pantalla y el número que decide el futuro del ticket pasaría a depender de
 * cuánto scrolleó el PO. Un contador así no es una métrica.
 *
 * **Lo que sí comparte, y tiene que compartir, es la caché de veredictos**: a
 * 37,57 ms por verificación medidos en el teléfono del PO, una firma que ya se
 * verificó no se vuelve a verificar nunca en ese dispositivo (D8).
 *
 * **Síncrono y sin red.** `authorKeysFor` resuelve contra lo local y **encola**
 * la consulta al directorio para el próximo drenado — así, mirar un gasto de
 * alguien que reinstaló es lo que dispara que su clave nueva llegue.
 */

/**
 * El veredicto del núcleo de un registro, para marcarlo.
 *
 * No aplica la regla D2 («clave stale ⇒ `no_verificable`, no `invalida`») y no
 * hace falta: D2 existe para no envenenar la medición, y acá las tres causas
 * comparten una sola marca — al usuario le dicen lo mismo.
 */
export function checkRecord<K extends CoreKind>(
  kind: K, record: CoreRecord[K],
  /**
   * Cómo encontrar la plantilla de un gasto materializado. Lo trae quien llama
   * —la pantalla, que ya lee ese store— y no se importa acá: `trustCheck` está
   * a un paso del merge y meterle un store más es cómo se arma un ciclo.
   */
  plantilla?: (templateId: string) => RecurringExpense | undefined,
): RecordVerdict {
  const { k, s } = record as { k?: string; s?: string };

  // Sin firma hay TRES casos y no se pueden mezclar: el histórico, que no se
  // re-firma nunca (R2, opción A); el derivado que SÍ se puede atribuir contra
  // su plantilla firmada (S9); y el que no se puede atribuir de ninguna forma
  // (D4). Los tres llevan marca, pero son cosas distintas y la medición los
  // cuenta aparte.
  if (!k || !s) {
    if (kind === 'expense' && plantilla) {
      const heredado = veredictoHeredadoDeLaPlantilla(record as unknown as Expense, plantilla);
      if (heredado) return heredado;
    }
    return derivedOriginOf(kind, record) !== null ? 'no_firmable' : 'no_verificable';
  }

  const authorId = authorOf(kind, record);
  if (!authorId) return 'no_verificable';

  return verifiedCore(kind, record, authorKeysFor(authorId, k));
}

/**
 * El veredicto de UN voto de borrado, para marcarlo.
 *
 * `verifyVote` (S8) no tenía llamador de producción: es éste. Va por fila
 * visible y **nunca en el merge** — a 37 ms por voto, verificar mientras se
 * mergea volvería inusable el drenado del relay (D9).
 *
 * Los votos no pasan por la caché de veredictos, que es de núcleos: son pocos
 * —los de la ronda vigente de un gasto abierto— y se pagan una vez por vista.
 */
/**
 * **Un gasto materializado hereda el veredicto de su plantilla** (S9 · D5).
 *
 * Nadie lo firmó y nadie podía: lo emite el primer device que abre la app
 * después del vencimiento. Pero deriva ENTERO de la plantilla, que sí está
 * firmada — así que si el gasto es fiel a la plantilla y la firma de la
 * plantilla cierra, el gasto es tan atribuible como ella.
 *
 * Devuelve `undefined` cuando no aplica —no es derivado, no está la plantilla,
 * o no le es fiel— y ahí el llamador sigue con la clasificación de siempre. No
 * se devuelve `invalida` en ese caso a propósito: que falte la plantilla es
 * falta de información, no una acusación, y es el caso normal de quien entró al
 * grupo después.
 */
function veredictoHeredadoDeLaPlantilla(
  expense: Expense,
  buscar: (templateId: string) => RecurringExpense | undefined,
): RecordVerdict | undefined {
  const origen = origenRecurrenteDe(expense.id);
  if (!origen) return undefined;

  const template = buscar(origen.templateId);
  if (!template) return undefined;
  if (!fielALaPlantilla(expense, template, origen.vencimiento)) return undefined;

  // La plantilla se verifica por el camino normal, con caché: es un registro
  // firmado como cualquier otro.
  return checkRecord('recurring', template);
}

export function checkVote(expenseId: string, vote: DeletionVote): CoreVerdict {
  return verifyVote(expenseId, vote, authorKeysFor(vote.userId, vote.k));
}
