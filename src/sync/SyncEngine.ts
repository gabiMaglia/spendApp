import { canonical } from '@/src/store/lww';
import { accionDe, frenaLaRonda, rondaDe, rondaVigente } from './voteCore';
import type { DeletionVote, Expense, SyncMeta } from '@/src/types/models';

/** Ventana para objetar un borrado (regla de negocio #2). */
export const DELETION_TIMEOUT_MS = 72 * 60 * 60 * 1000;

export class SyncEngine {
  /**
   * Last-Write-Wins merge por `updatedAt`.
   * Si isDeleted=true con updatedAt mayor, el borrado se propaga.
   */
  mergeData<T extends SyncMeta>(local: T[], remote: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of local)  map.set(item.id, item);
    for (const item of remote) {
      const existing = map.get(item.id);
      if (!existing || item.updatedAt > existing.updatedAt) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  /**
   * Delta: solo registros más nuevos que el último sync del peer.
   */
  buildDelta<T extends SyncMeta>(allRecords: T[], peerLastSync: number): T[] {
    return allRecords.filter(r => r.updatedAt > peerLastSync);
  }
}

// ── Borrado consensuado ──────────────────────────────────────────────────────

/**
 * Desde cuándo cuenta la ronda abierta en este conjunto.
 *
 * La ronda la abre el pedido de borrado más VIEJO del conjunto — es la misma
 * definición que ya usa `deletionRound()` para calcular el vencimiento, y es
 * desde cuándo la gente tuvo aviso. `undefined` = no hay ninguna ronda abierta.
 */
function aperturaDeRonda(votes: readonly DeletionVote[]): number | undefined {
  let apertura: number | undefined;
  for (const v of votes) {
    if (accionDe(v) !== 'delete') continue;
    if (apertura === undefined || v.votedAt < apertura) apertura = v.votedAt;
  }
  return apertura;
}

/**
 * **Une dos versiones del conjunto de votos** (T-041 · S7).
 *
 * Los votos son el nivel COLABORATIVO del registro: los escriben terceros que
 * no tienen la privada del autor. Resolverlos por el LWW del registro entero
 * —lo que se hacía hasta S6— hace que el voto de Beto desaparezca en cuanto Ana
 * edita su gasto sin haberlo visto, porque su copia gana por `updatedAt` y se
 * lleva puesto el conjunto. Nadie se entera: el borrado simplemente no ocurre.
 *
 * Pero unir a secas rompe la regla #2, y ahí está la parte delicada: pedir el
 * borrado **arranca de cero a propósito** (`app/expense/[id].tsx`). Con una
 * unión ciega, una objeción vieja bloquearía todo pedido futuro y —peor— un
 * pedido viejo volvería con su `votedAt` original y vencería al instante,
 * borrando un gasto sin darle a nadie sus 72hs.
 *
 * Por eso la unión es **por ronda**: se unen los votos de la ronda más nueva y
 * los anteriores a su apertura no se arrastran. Es el mismo criterio que
 * `mergeApprovals` ya usa para las aprobaciones de salida — se une adentro de
 * la ronda, y entre rondas gana la última.
 *
 * El resultado sale ORDENADO y sin duplicados: los dos dispositivos tienen que
 * guardar exactamente el mismo array, o el desempate canónico del LWW elegiría
 * distinto en cada uno.
 */
export function mergeDeletionVoteSets(
  a: readonly DeletionVote[] | undefined,
  b: readonly DeletionVote[] | undefined,
): DeletionVote[] {
  const A = a ?? [];
  const B = b ?? [];

  const apA = aperturaDeRonda(A);
  const apB = aperturaDeRonda(B);
  const desde = apA === undefined ? apB : apB === undefined ? apA : Math.max(apA, apB);

  const porContenido = new Map<string, DeletionVote>();
  for (const v of [...A, ...B]) {
    if (desde !== undefined && v.votedAt < desde) continue;
    porContenido.set(canonical(v), v);
  }

  return [...porContenido]
    .sort(([ka, va], [kb, vb]) => va.votedAt - vb.votedAt || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, v]) => v);
}

/**
 * Los votos VIGENTES: el último enunciado de cada persona en cada ronda.
 *
 * Colapsa por `(roundId, userId)` y no sólo por `userId` (T-041 · S8): una
 * persona puede tener votos en dos rondas a la vez mientras el conjunto se
 * está uniendo, y colapsarlos entre sí dejaría que su voto de una ronda vieja
 * pisara el de la de ahora. Lo que no trae `roundId` —todo lo anterior a S8 y
 * todo lo de un peer sin actualizar— cae en la ronda sintética `''`, que es
 * exactamente el comportamiento de antes.
 */
export function mergeDeletionVotes(votes: DeletionVote[]): DeletionVote[] {
  const map = new Map<string, DeletionVote>();
  for (const vote of votes) {
    const clave = `${rondaDe(vote)}\u0000${vote.userId}`;
    const existing = map.get(clave);
    if (!existing || vote.votedAt > existing.votedAt) {
      map.set(clave, vote);
    }
  }
  return Array.from(map.values());
}

/** El último voto de esta persona, mire la ronda que mire. */
function ultimoDe(vigentes: DeletionVote[], userId: string): DeletionVote | undefined {
  let ultimo: DeletionVote | undefined;
  for (const v of vigentes) {
    if (v.userId !== userId) continue;
    if (!ultimo || v.votedAt > ultimo.votedAt) ultimo = v;
  }
  return ultimo;
}

/**
 * ¿Este gasto tiene que quedar borrado?
 *
 * Tres reglas, y la del medio es la que S8 tuvo que escribir explícita:
 *
 * 1. **El override del creador se honra SIEMPRE** (R3 del PO), verifique su
 *    firma o no. Su contraparte es deshacerlo en un toque: un `object` o un
 *    `restore` posteriores lo anulan. Sin eso, restaurar un borrado forzado no
 *    funcionaría nunca —desde S7 los votos se unen en vez de pisarse, así que
 *    el `forced` sobrevive y `resolvePendingDeletions` re-borra el gasto en el
 *    próximo arranque.
 *
 * 2. **Un voto sólo habla por quien lo firmó.** `object` y `restore` son
 *    enunciados sobre la RONDA y la frenan para todos; `withdraw` retira el
 *    pedido de su autor y nada más. Por eso un `withdraw` no compite contra el
 *    `delete` de otra persona: los `votedAt` de personas distintas no se
 *    comparan entre sí. Decidirlo por el `votedAt` mayor —un LWW entre votos—
 *    le daría a cualquiera un veto sin atribución sobre el pedido ajeno, que es
 *    justo lo que `object` existe para hacer de forma visible; y volvería a ser
 *    "sacar votos" con otro nombre, que es el bug que S7 cerró.
 *
 * 3. **72hs desde la apertura de la ronda vigente.** Si el que abrió se retira,
 *    el plazo se recuenta desde el pedido que queda: es igual o posterior, así
 *    que la ventana para objetar nunca se acorta.
 */
export function resolveDeletionVotes(
  expense: Expense,
  _memberIds: string[],
  now: number = Date.now(),
): boolean {
  const vigentes = mergeDeletionVotes(expense.deletionVotes ?? []);

  const delCreador = ultimoDe(vigentes, expense.createdById);
  if (delCreador && accionDe(delCreador) === 'delete' && delCreador.forced) {
    const deshecho = vigentes.some(
      v => frenaLaRonda(v) && v.votedAt > delCreador.votedAt,
    );
    if (!deshecho) return true;
  }

  const ronda = rondaVigente(vigentes);
  if (ronda === null || ronda.freno !== undefined) return false;

  return now - ronda.apertura.votedAt > DELETION_TIMEOUT_MS;
}
