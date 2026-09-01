import { mergeDeletionVoteSets, resolveDeletionVotes, DELETION_TIMEOUT_MS } from '../SyncEngine';
import { deletionRound } from '@/src/algorithms/deletionRound';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **El nivel colaborativo del merge** (T-041 · S7).
 *
 * `deletionVotes` no es un campo del autor: es un conjunto de aportes de gente
 * distinta. Resolverlo por LWW del registro entero —como hasta S6— hace que el
 * voto de un tercero desaparezca en cuanto el autor edita su gasto, sin que
 * nadie se entere. Se une.
 *
 * Pero un conjunto que sólo crece no puede abrir rondas, y la regla #2 vive de
 * abrir rondas: pedir el borrado ARRANCA DE CERO a propósito
 * (`app/expense/[id].tsx`), porque si no una objeción vieja bloquearía todo
 * pedido futuro y un pedido viejo vencería al instante al reabrirse — borrando
 * sin darle a nadie sus 72hs.
 *
 * La unión es, entonces, **por ronda**: la ronda es la que abrió el pedido de
 * borrado más NUEVO, y los votos anteriores a esa apertura no se arrastran. Es
 * el mismo criterio que `mergeApprovals` ya usa para las aprobaciones de salida
 * (`leaveRequest.ts`): se une dentro de la ronda, y entre rondas gana la última.
 */

const pide    = (u: string, t: number): DeletionVote => ({ userId: u, votedAt: t, action: 'delete' });
const objeta  = (u: string, t: number): DeletionVote => ({ userId: u, votedAt: t, action: 'cancel' });
const fuerza  = (u: string, t: number): DeletionVote => ({ userId: u, votedAt: t, action: 'delete', forced: true });

const ids = (vs: DeletionVote[]) => vs.map(v => `${v.userId}:${v.action}:${v.votedAt}`).sort();

describe('mergeDeletionVoteSets — se une, no se pisa', () => {
  it('el voto de un tercero sobrevive a una versión que no lo tiene', () => {
    expect(ids(mergeDeletionVoteSets([], [pide('beto', 100)]))).toEqual(['beto:delete:100']);
    expect(ids(mergeDeletionVoteSets([pide('beto', 100)], []))).toEqual(['beto:delete:100']);
  });

  it('dos votos distintos de la misma ronda se juntan', () => {
    const out = mergeDeletionVoteSets([pide('beto', 100)], [pide('beto', 100), objeta('caro', 150)]);
    expect(ids(out)).toEqual(['beto:delete:100', 'caro:cancel:150']);
  });

  it('el mismo voto por los dos lados no se duplica', () => {
    expect(mergeDeletionVoteSets([pide('beto', 100)], [pide('beto', 100)])).toHaveLength(1);
  });

  it('tolera lados ausentes (peer viejo, registro a medio escribir)', () => {
    expect(mergeDeletionVoteSets(undefined, undefined)).toEqual([]);
    expect(ids(mergeDeletionVoteSets(undefined, [pide('beto', 100)]))).toEqual(['beto:delete:100']);
  });
});

describe('mergeDeletionVoteSets — la ronda nueva no arrastra la vieja', () => {
  it('un pedido nuevo descarta los votos anteriores a su apertura', () => {
    // Ana pide de nuevo a los 500. Lo de la ronda vieja (100/150) no vuelve.
    const out = mergeDeletionVoteSets([pide('ana', 500)], [pide('beto', 100), objeta('caro', 150)]);
    expect(ids(out)).toEqual(['ana:delete:500']);
  });

  it('una objeción POSTERIOR a la apertura nueva sí entra', () => {
    const out = mergeDeletionVoteSets([pide('ana', 500)], [pide('beto', 100), objeta('caro', 900)]);
    expect(ids(out)).toEqual(['ana:delete:500', 'caro:cancel:900']);
  });

  it('sin ningún pedido de borrado, se unen todos', () => {
    const out = mergeDeletionVoteSets([objeta('ana', 100)], [objeta('beto', 200)]);
    expect(ids(out)).toEqual(['ana:cancel:100', 'beto:cancel:200']);
  });
});

describe('mergeDeletionVoteSets — convergencia', () => {
  const A = [pide('beto', 100)];
  const B = [pide('beto', 100), objeta('caro', 150)];
  const C = [pide('ana', 500)];

  it('el orden de llegada no cambia el resultado', () => {
    const d1 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, B), C);
    const d2 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, C), B);
    const d3 = mergeDeletionVoteSets(mergeDeletionVoteSets(B, C), A);
    expect(ids(d1)).toEqual(ids(d2));
    expect(ids(d1)).toEqual(ids(d3));
  });

  it('el resultado es idéntico campo a campo, no sólo equivalente', () => {
    // Los dos devices guardan el array y lo vuelven a mergear: si el ORDEN
    // difiere, el desempate canónico del LWW elige distinto en cada uno.
    const d1 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, B), C);
    const d2 = mergeDeletionVoteSets(C, mergeDeletionVoteSets(B, A));
    expect(d1).toEqual(d2);
  });

  it('mergear dos veces lo mismo no cambia nada (idempotente)', () => {
    const una = mergeDeletionVoteSets(A, B);
    expect(mergeDeletionVoteSets(una, B)).toEqual(una);
  });
});

describe('resolveDeletionVotes — deshacer le gana al forzado anterior (R3)', () => {
  const gasto = (votes: DeletionVote[]): Expense =>
    ({ id: 'e1', createdById: 'ana', deletionVotes: votes } as Expense);

  it('el creador que fuerza sigue borrando al instante', () => {
    expect(resolveDeletionVotes(gasto([fuerza('ana', 1_000)]), [], 1_000)).toBe(true);
  });

  it('una objeción ANTERIOR no lo frena', () => {
    expect(resolveDeletionVotes(gasto([objeta('beto', 500), fuerza('ana', 1_000)]), [], 1_000)).toBe(true);
  });

  /**
   * Sin esto, restaurar un borrado forzado no funciona nunca: con la unión el
   * voto `forced` sobrevive para siempre y `resolvePendingDeletions` vuelve a
   * borrar el gasto en el próximo arranque. R3 del PO es explícita — el
   * override se honra siempre, y la contraparte es que deshacer sea de un toque.
   */
  it('una objeción POSTERIOR lo deshace', () => {
    expect(resolveDeletionVotes(gasto([fuerza('ana', 1_000), objeta('beto', 2_000)]), [], 2_000)).toBe(false);
  });

  it('el pedido normal sigue venciendo a las 72hs', () => {
    const g = gasto([pide('beto', 0)]);
    expect(resolveDeletionVotes(g, [], DELETION_TIMEOUT_MS - 1)).toBe(false);
    expect(resolveDeletionVotes(g, [], DELETION_TIMEOUT_MS + 1)).toBe(true);
  });
});

describe('la ronda se lee igual después de unir', () => {
  it('el pedido más viejo de la ronda define el vencimiento', () => {
    const votos = mergeDeletionVoteSets([pide('beto', 100)], [objeta('caro', 900)]);
    const ronda = deletionRound({ deletionVotes: votos } as Expense);
    expect(ronda?.requestedAt).toBe(100);
    expect(ronda?.status === 'objected').toBe(true);
  });
});
