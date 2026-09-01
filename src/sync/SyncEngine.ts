import { canonical } from '@/src/store/lww';
import {
  accionDe, enElFuturo, frenaLaRonda, masNuevoPorFecha, rondaDe, rondaVigente,
} from './voteCore';
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
 * Es la misma definición de dos pasos que usa `rondaVigente()`: la apertura de
 * cada ronda es su pedido más VIEJO —desde cuándo la gente tuvo aviso— y entre
 * rondas manda la que abrió más tarde. `undefined` = no hay ninguna ronda.
 *
 * **Los dos pasos hacen falta desde T-059**: antes esto era el pedido más viejo
 * del conjunto entero, y funcionaba porque la poda dejaba una sola ronda por
 * lado. Ahora las rondas nombradas conviven, y con un solo `min` la unión de
 * dos conjuntos devolvía una apertura MÁS VIEJA que uno de sus dos insumos —
 * así que podar dependía del orden en que se hubiera mergeado, que es
 * exactamente la divergencia que esta función existe para evitar.
 *
 * Por fecha pelada, sin juzgar credibilidad: acá no hay reloj, y meterlo haría
 * que dos teléfonos guardaran arrays distintos según cuándo mergearon.
 */
function aperturaDeRonda(votes: readonly DeletionVote[]): number | undefined {
  const aperturas = new Map<string, DeletionVote>();
  for (const v of votes) {
    if (accionDe(v) !== 'delete') continue;
    const previa = aperturas.get(rondaDe(v));
    if (previa === undefined || masNuevoPorFecha(previa, v)) aperturas.set(rondaDe(v), v);
  }

  let apertura: DeletionVote | undefined;
  for (const v of aperturas.values()) {
    if (apertura === undefined || masNuevoPorFecha(v, apertura)) apertura = v;
  }
  return apertura?.votedAt;
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
 *
 * **La poda por tiempo es sólo para los votos que no saben nombrar su ronda**
 * (T-059). El corte lo fija la apertura más nueva del conjunto y `votedAt` lo
 * escribe el que vota: un teléfono con el reloj adelantado ponía el corte en
 * 2027 y **borraba del conjunto el pedido real del otro lado**, no sólo le
 * ganaba la ronda. Contra eso no hay capa de lectura que valga — el voto ya no
 * está.
 *
 * Las rondas NOMBRADAS pueden dejar de podarse porque desde S8 separarlas no
 * depende del tiempo: cada voto dice a qué ronda pertenece, la apertura de cada
 * ronda es su propio pedido más viejo y una objeción de otra ronda no frena la
 * de ahora (`rondaVigente`). El corte por tiempo lo siguen necesitando el
 * histórico y el peer que no actualizó, que caen en la ronda sintética `''`:
 * ahí sí, sin poda, una objeción vieja bloquearía todo pedido futuro y un
 * pedido viejo vencería al instante al reabrirse — el bug que S7 cerró.
 *
 * **Lo que queda expuesto, y es el lado seguro**: un `votedAt` del futuro
 * todavía puede podar votos SIN `roundId`. No alcanza para borrar nada — esa
 * ronda tiene el vencimiento en el futuro, así que no vence nunca — y para
 * taparlo habría que mirar el reloj acá, que es justo lo que rompe la
 * convergencia.
 *
 * **Esta función sigue siendo pura**: no mira el reloj. Un corte que dependiera
 * de "ahora" haría que dos teléfonos guardaran arrays distintos según cuándo
 * mergearon, y el desempate canónico del LWW elegiría distinto en cada uno.
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
    if (desde !== undefined && v.votedAt < desde && rondaDe(v) === '') continue;
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
 *
 * **Cuál es el último enunciado de una persona no lo decide la fecha mayor sino
 * la fecha creíble mayor** (T-059): si no, quien abrió una ronda con el reloj
 * adelantado no puede retirarla nunca —su propio retiro queda "anterior" a su
 * pedido— y el pedido sigue colgado hasta que el tiempo real alcance su reloj.
 */
export function mergeDeletionVotes(votes: DeletionVote[], now: number): DeletionVote[] {
  const map = new Map<string, DeletionVote>();
  for (const vote of votes) {
    const clave = `${rondaDe(vote)}\u0000${vote.userId}`;
    const existing = map.get(clave);
    if (!existing || ultimoEntre(vote, existing, now)) {
      map.set(clave, vote);
    }
  }
  return Array.from(map.values());
}

/**
 * ¿`a` es el enunciado vigente frente a `b`?
 *
 * Un `votedAt` del futuro no lo es frente a uno creíble; entre dos igual de
 * creíbles manda la fecha (T-059). Vive acá y no en `voteCore` porque acá se
 * compara siempre entre enunciados de LA MISMA PERSONA — los votos de personas
 * distintas no se comparan nunca por fecha (regla 2 de `resolveDeletionVotes`).
 */
function ultimoEntre(a: DeletionVote, b: DeletionVote, now: number): boolean {
  const futuroA = enElFuturo(a, now);
  const futuroB = enElFuturo(b, now);
  if (futuroA !== futuroB) return futuroB;
  return masNuevoPorFecha(a, b);
}

/** El último voto de esta persona, mire la ronda que mire. */
function ultimoDe(
  vigentes: DeletionVote[], userId: string, now: number,
): DeletionVote | undefined {
  let ultimo: DeletionVote | undefined;
  for (const v of vigentes) {
    if (v.userId !== userId) continue;
    if (!ultimo || ultimoEntre(v, ultimo, now)) ultimo = v;
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
  const vigentes = mergeDeletionVotes(expense.deletionVotes ?? [], now);

  const delCreador = ultimoDe(vigentes, expense.createdById, now);
  if (delCreador && accionDe(delCreador) === 'delete' && delCreador.forced) {
    // "Posterior" con el reloj en la mano (T-059): si el `forced` viene con
    // fecha del futuro, ningún `restore` real sería posterior y el borrado
    // quedaría indeshacible — la contraparte que R3 le pone al override.
    const deshecho = vigentes.some(
      v => frenaLaRonda(v) && ultimoEntre(v, delCreador, now),
    );
    if (!deshecho) return true;
  }

  const ronda = rondaVigente(vigentes, now);
  if (ronda === null || ronda.freno !== undefined) return false;

  return now - ronda.apertura.votedAt > DELETION_TIMEOUT_MS;
}
