import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { marcarConTopic } from '@/src/sync/pendingDrain';

/**
 * **Salir de un grupo, en el orden que importa** (T-089 · §5).
 *
 * Son tres cosas y **el orden entre ellas no es preferencia**:
 *
 *  1. **sacarse del roster y que eso SALGA** — si no, el grupo nunca se entera;
 *  2. **marcar el grupo como pendiente de drenaje** — desde acá este teléfono no
 *     vuelve a publicar hasta haber leído el buzón, porque conserva la clave y
 *     puede reingresar (no hay rotación de época);
 *  3. **purgar la copia local** — lo único que puede hacer cierto el «arranca
 *     desde 0» del PO.
 *
 * ⚠️ **Corrección sobre la spec, encontrada al implementar.** El §3.2 proponía
 * marcar adentro de `groupStore.leaveGroup`, «después del `schedulePublish`».
 * **No alcanza**: ese `schedulePublish` es un `setTimeout`, así que cuando por
 * fin dispara la marca ya está puesta y **bloquea la publicación de salida** —
 * el grupo se quedaría sin enterarse de que la persona se fue. Por eso la marca
 * se pone acá, **después de que la publicación terminó de verdad**, y no adentro
 * del store.
 *
 * **Por qué la purga no contradice la regla #1** («nunca DELETE físico, siempre
 * tombstone»): esa regla gobierna **lo que se sincroniza**. Un tombstone es un
 * registro que viaja para que el otro también borre. Acá el borrado es local y
 * unilateral: nadie más se entera y nada viaja. Hacerlo con tombstones les
 * borraría los gastos a los que se quedaron, que es exactamente el daño que
 * T-074 §1 se niega a hacer.
 *
 * Y lo que la investigación de Splitwise confirmó (P-16, 2026-09-08): **el grupo
 * no olvida nada**. Los gastos de quien se fue siguen ahí para los demás, y si
 * vuelve los ve de nuevo. Lo único que se limpia es su propia copia.
 */
export async function salirDelGrupo(groupId: string, userId: string): Promise<void> {
  // 1 · el roster, y que la publicación salga de verdad antes de trabar nada.
  useGroupStore.getState().leaveGroup(groupId, userId);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishNow } = require('@/src/sync/relayEngine') as typeof import('@/src/sync/relayEngine');
    await publishNow(groupId);
  } catch {
    /**
     * Sin red el grupo se entera más tarde… pero la copia local ya se purgó, así
     * que **no hay “más tarde”**: este teléfono no va a poder republicar la
     * salida. Es el costo declarado de que salir sea inmediato, y es el mismo
     * que ya tiene el borrado de cuenta (T-074): el que se fue se fue, y los que
     * quedan lo ven cuando alguno de ellos lo republique.
     */
  }

  // 2 · desde acá, este grupo no publica hasta drenar.
  await marcarConTopic([groupId]);

  // 3 · la copia local.
  purgarGrupoLocalmente(groupId);
}

/**
 * Borra del dispositivo todo lo de un grupo. **Local y unilateral: nada viaja.**
 *
 * Los `User` de los demás **NO se tocan**: pueden estar en otros grupos, y
 * borrarlos dejaría esos grupos mostrando ids en vez de nombres.
 *
 * La técnica —vaciar y volver a mergear a los sobrevivientes— es la misma que ya
 * usa `applyBackup` (`src/services/backup.ts`), y por el mismo motivo: no hace
 * falta agregarle un método nuevo a cada store.
 */
export function purgarGrupoLocalmente(groupId: string): void {
  /**
   * Los comentarios no tienen `groupId`: cuelgan del gasto. Así que los ids de
   * los gastos de este grupo se calculan **antes** de purgarlos — después ya no
   * hay contra qué resolverlos.
   */
  const gastosDelGrupo = new Set(
    useExpenseStore.getState().expenses.filter(e => e.groupId === groupId).map(e => e.id),
  );

  reemplazar(useExpenseStore, 'expenses', s => s.expenses.filter(e => e.groupId !== groupId),
    (st, v) => st.mergeExpenses(v));
  reemplazar(usePaymentStore, 'payments', s => s.payments.filter(p => p.groupId !== groupId),
    (st, v) => st.mergePayments(v));
  reemplazar(useRecurringStore, 'recurring', s => s.recurring.filter(r => r.groupId !== groupId),
    (st, v) => st.mergeRecurring(v));
  reemplazar(useCommentStore, 'comments', s => s.comments.filter(c => !gastosDelGrupo.has(c.expenseId)),
    (st, v) => st.mergeComments(v));
  reemplazar(useGroupStore, 'groups', s => s.groups.filter(g => g.id !== groupId),
    (st, v) => st.mergeGroups(v));

  // La clave del grupo: sin ella este teléfono ya no puede abrir sus sobres.
  // El cursor del topic lo olvidó `marcarConTopic` antes de llegar acá.
  useGroupKeyStore.getState().forgetKey(groupId);
}

/**
 * Vaciar y volver a mergear a los sobrevivientes.
 *
 * Es exactamente la técnica de `applyBackup` (`src/services/backup.ts`) y por el
 * mismo motivo: el merge sobre una lista vacía agrega todo, así que el resultado
 * es la lista que se le pasa — y **se persiste**, porque persistir es lo que
 * hacen los `mergeX`. No hace falta agregarle un método nuevo a cada store.
 */
function reemplazar<S, K extends string>(
  store: { getState: () => S; setState: (p: Record<K, never[]>) => void },
  campo: K,
  sobrevivientes: (s: S) => unknown[],
  volverAMeter: (s: S, v: never[]) => void,
): void {
  const quedan = sobrevivientes(store.getState()) as never[];
  store.setState({ [campo]: [] } as Record<K, never[]>);
  volverAMeter(store.getState(), quedan);
}
