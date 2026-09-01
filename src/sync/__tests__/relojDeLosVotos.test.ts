import {
  mergeDeletionVoteSets, mergeDeletionVotes, resolveDeletionVotes, DELETION_TIMEOUT_MS,
} from '../SyncEngine';
import { rondaVigente, TOLERANCIA_RELOJ_MS } from '../voteCore';
import { deletionRound, hasObjected, hasRequested } from '@/src/algorithms/deletionRound';
import { emitirVoto } from '@/src/services/deletionVotes';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **Los dos relojes conviviendo** (T-059).
 *
 * `votedAt` pasa a salir de `syncedNow()` (ADR-005), pero por R2 —opción A— el
 * histórico NO se re-fecha nunca: van a convivir para siempre votos estampados
 * con el reloj del teléfono y votos estampados con el corregido. Y hay un
 * tercer emisor que no se apaga solo: **un peer que no actualizó y sigue
 * mandando `Date.now()` por tiempo indefinido.**
 *
 * Lo que este archivo fija es la regla que hace que los tres convivan:
 *
 * > Un `votedAt` posterior a *ahora* no es "más nuevo": es una fecha que
 * > todavía no pudo haber ocurrido. No se descarta el voto —nada deja de
 * > aplicarse— pero **pierde contra cualquier enunciado creíble**.
 *
 * Es exactamente lo que ADR-005 ya garantiza y nada más: nuestro reloj
 * corregido es una referencia razonable de la hora real. No se inventa
 * causalidad (eso es la opción A del ADR, que el PO descartó).
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const AHORA  = Date.UTC(2026, 8, 1, 12);
const HORA   = 3_600_000;
/** Un teléfono con el año mal puesto. El caso que reportó S7. */
const FUTURO = AHORA + 400 * 24 * HORA;

const gasto = (votes: DeletionVote[], over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto', 'caro'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false, ...over,
} as Expense);

/** Un voto de los de ahora: nombra su ronda (S8). */
const pide   = (u: string, at: number, r: string): DeletionVote => ({ userId: u, votedAt: at, action: 'delete', roundId: r });
const objeta = (u: string, at: number, r: string): DeletionVote => ({ userId: u, votedAt: at, action: 'cancel', roundId: r });
const fuerza = (u: string, at: number, r: string): DeletionVote => ({ userId: u, votedAt: at, action: 'delete', forced: true, roundId: r });
const restaura = (u: string, at: number, r: string): DeletionVote => ({ userId: u, votedAt: at, action: 'cancel', intent: 'restore', roundId: r });
const retira = (u: string, at: number, r: string): DeletionVote => ({ userId: u, votedAt: at, action: 'withdraw', roundId: r });

/** Un voto de los de antes de S8: no sabe nombrar su ronda. */
const pideViejo   = (u: string, at: number): DeletionVote => ({ userId: u, votedAt: at, action: 'delete' });
const objetaViejo = (u: string, at: number): DeletionVote => ({ userId: u, votedAt: at, action: 'cancel' });

const ids = (vs: readonly DeletionVote[]) =>
  vs.map(v => `${v.userId}:${v.action}:${v.votedAt}:${v.roundId ?? ''}`).sort();

// ── 1. Una ronda con fecha futura no le gana a una nueva y real ──────────────

describe('la ronda del reloj adelantado no le gana a una nueva y real', () => {
  it('entre dos rondas gana la creíble, aunque la otra diga ser más nueva', () => {
    const votos = [pide('ana', FUTURO, 'rf'), pide('beto', AHORA, 'rb')];
    const r = rondaVigente(mergeDeletionVotes(votos, AHORA), AHORA)!;

    expect(r.roundId).toBe('rb');
    expect(r.apertura.userId).toBe('beto');
  });

  it('y la ronda que la app muestra es la real', () => {
    const e = gasto([pide('ana', FUTURO, 'rf'), pide('beto', AHORA, 'rb')]);
    const r = deletionRound(e, AHORA)!;

    expect(r.roundId).toBe('rb');
    expect(r.requestedBy).toBe('beto');
    expect(r.expiresAt).toBe(AHORA + DELETION_TIMEOUT_MS);
  });

  /**
   * El merge es donde más caro salía: la poda por tiempo cortaba TODO lo
   * anterior a la apertura más nueva, así que una fecha del futuro no sólo
   * ganaba la ronda — **borraba del conjunto el pedido real de la otra
   * persona**, y ya no había capa de lectura que lo pudiera arreglar.
   */
  it('el merge no puede borrar la ronda que el otro lado tiene abierta', () => {
    const out = mergeDeletionVoteSets([pide('beto', AHORA, 'rb')], [pide('ana', FUTURO, 'rf')]);

    expect(ids(out)).toEqual([`ana:delete:${FUTURO}:rf`, `beto:delete:${AHORA}:rb`]);
    expect(deletionRound(gasto(out), AHORA)!.roundId).toBe('rb');
  });

  /**
   * Un `forced` con fecha futura no puede volverse indeshacible: sin esto,
   * ningún `restore` real es "posterior" nunca y el gasto se re-borra en cada
   * arranque. R3 del PO dice que la contraparte del override es deshacerlo de
   * un toque.
   */
  it('un `forced` con fecha futura se puede deshacer con un restore real', () => {
    const e = gasto([fuerza('ana', FUTURO, 'rf'), restaura('beto', AHORA, 'rf')]);
    expect(resolveDeletionVotes(e, [], AHORA)).toBe(false);
  });

  /**
   * Ni siquiera su propio autor podía retirarla: el colapso por
   * `(roundId, userId)` se quedaba con el `votedAt` mayor, que es el del
   * futuro, y el retiro desaparecía en silencio.
   */
  it('el que la abrió puede retirarla, y el retiro sobrevive al sync', () => {
    const pedido = emitirVoto(gasto([]), 'beto', 'delete', FUTURO);
    expect(deletionRound(gasto(pedido), AHORA)).not.toBeNull();

    const retiro = emitirVoto(gasto(pedido), 'beto', 'withdraw', AHORA);
    // Retirar saca mi voto anterior de MI copia, pero el peer todavía lo tiene
    // y vuelve en el primer sync: es ahí donde el colapso por
    // `(roundId, userId)` tiene que quedarse con el retiro y no con el futuro.
    const unido = mergeDeletionVoteSets(retiro, pedido);

    expect(ids(unido)).toHaveLength(2);
    expect(deletionRound(gasto(unido), AHORA)).toBeNull();
  });

  /**
   * El límite de la regla: el desfase entre dos relojes ya corregidos es de
   * milisegundos, así que la tolerancia existe para el ruido y no para tapar un
   * reloj mal puesto. Dentro de la tolerancia manda la fecha, como siempre.
   */
  it('unos segundos adelante siguen contando como más nuevo', () => {
    const apenas = AHORA + TOLERANCIA_RELOJ_MS - 1_000;
    const votos = [pide('ana', apenas, 'rq'), pide('beto', AHORA, 'rb')];

    expect(rondaVigente(mergeDeletionVotes(votos, AHORA), AHORA)!.roundId).toBe('rq');
  });
});

/**
 * Las rondas nombradas ya no se podan (ver `mergeDeletionVoteSets`), así que la
 * ronda anterior se queda en el conjunto. Todo lo que lee "quién hizo qué"
 * tiene que estar acotado a la ronda VIGENTE, o la app cuenta una historia que
 * no pasó: un botón escondido por una objeción de un trámite ya cerrado, o una
 * banda que le atribuye el freno a la persona equivocada.
 */
describe('la ronda anterior queda en el conjunto, pero no habla por la de ahora', () => {
  const conDosRondas = gasto([
    pide('ana', AHORA - 2 * HORA, 'r0'), objeta('caro', AHORA - 90 * 60_000, 'r0'),
    pide('beto', AHORA - HORA, 'rb'),
  ]);

  it('la objeción de la ronda cerrada no dice «ya objetaste» en la nueva', () => {
    expect(hasObjected(conDosRondas, 'caro', AHORA)).toBe(false);
  });

  it('ni el pedido de la ronda cerrada dice «ya pediste»', () => {
    expect(hasRequested(conDosRondas, 'ana', AHORA)).toBe(false);
    expect(hasRequested(conDosRondas, 'beto', AHORA)).toBe(true);
  });

  /**
   * Y sin ninguna ronda viva no hay nada objetado: quien retiró su pedido deja
   * un conjunto con objeciones y sin pedidos, y ahí «ya objetaste» no describe
   * ningún trámite en curso.
   */
  it('sin ronda vigente nadie «ya objetó»', () => {
    const e = gasto([objeta('caro', AHORA - HORA, 'r0'), retira('ana', AHORA, 'r0')]);

    expect(deletionRound(e, AHORA)).toBeNull();
    expect(hasObjected(e, 'caro', AHORA)).toBe(false);
  });

  /**
   * Y el freno que se atribuye es el creíble. Con la fecha pelada, un `restore`
   * del futuro le roba la banda a la objeción real y el cartel diría
   * «dana restauró» cuando lo que pasó fue «caro objetó» (R-Q2 del PO).
   */
  it('la banda atribuye el freno creíble, no el del futuro', () => {
    const e = gasto([
      pide('beto', AHORA - 2 * HORA, 'rb'),
      objeta('caro', AHORA - HORA, 'rb'),
      restaura('dana', FUTURO, 'rb'),
    ]);
    const r = deletionRound(e, AHORA)!;

    expect(r.status).toBe('objected');
    expect(r.stoppedBy).toBe('caro');
  });
});

// ── 2. El plazo de 72hs con los dos relojes conviviendo ──────────────────────

describe('el plazo de 72hs con votos de los dos relojes', () => {
  /** Sin nada raro alrededor: el histórico sigue venciendo como siempre. */
  it('una ronda abierta con el reloj viejo vence a las 72hs, ni antes ni después', () => {
    const e = gasto([pideViejo('beto', AHORA - DELETION_TIMEOUT_MS)]);

    expect(resolveDeletionVotes(e, [], AHORA - 1)).toBe(false);
    expect(resolveDeletionVotes(e, [], AHORA + 1)).toBe(true);
  });

  /**
   * Y con un voto del futuro en el mismo conjunto: el plazo se sigue contando
   * desde la apertura REAL. Si la ronda del futuro ganara, el pedido legítimo
   * de hace tres días no vencería nunca.
   */
  it('un voto con fecha futura al lado no le corre el vencimiento', () => {
    const e = gasto([
      pideViejo('beto', AHORA - DELETION_TIMEOUT_MS),
      pide('ana', FUTURO, 'rf'),
    ]);

    expect(resolveDeletionVotes(e, [], AHORA - 1)).toBe(false);
    expect(resolveDeletionVotes(e, [], AHORA + 1)).toBe(true);
    expect(deletionRound(e, AHORA)!.requestedAt).toBe(AHORA - DELETION_TIMEOUT_MS);
  });

  /**
   * Un voto viejo YA PERSISTIDO con fecha futura no se arregla cambiando la
   * fuente del reloj: va a seguir ahí. Lo que se le exige es que no borre nada
   * — su ronda no vence nunca (errar hacia NO borrar es el lado seguro) y
   * cualquiera puede abrir una nueva encima.
   */
  it('la ronda del futuro no vence nunca: un reloj adelantado no acelera un borrado', () => {
    const e = gasto([pide('ana', FUTURO, 'rf')]);

    expect(resolveDeletionVotes(e, [], AHORA)).toBe(false);
    expect(resolveDeletionVotes(e, [], AHORA + DELETION_TIMEOUT_MS + 1)).toBe(false);
  });
});

// ── 3. El peer que no actualizó ──────────────────────────────────────────────

describe('un peer que sigue mandando `Date.now()`', () => {
  /**
   * No se puede exigir que todos actualicen a la vez: mientras uno no lo haga,
   * sus votos llegan estampados con su reloj y sin nada que los distinga. Con
   * el reloj bien puesto tienen que seguir funcionando IGUAL que antes, en las
   * dos direcciones.
   */
  it('su objeción frena mi ronda', () => {
    const mio = emitirVoto(gasto([]), 'yo', 'delete', AHORA);
    const suyo = objetaViejo('peer', AHORA + HORA); // sin roundId: no sabe nombrarla

    const e = gasto(mergeDeletionVoteSets(mio, [...mio, suyo]));
    const r = deletionRound(e, AHORA + 2 * HORA)!;

    expect(r.status).toBe('objected');
    expect(r.stoppedBy).toBe('peer');
    expect(resolveDeletionVotes(e, [], AHORA + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });

  it('su pedido abre una ronda que yo puedo frenar', () => {
    const suyo = [pideViejo('peer', AHORA)];
    const conMiObjecion = emitirVoto(gasto(suyo), 'yo', 'object', AHORA + HORA);

    const e = gasto(mergeDeletionVoteSets(suyo, conMiObjecion));
    expect(deletionRound(e, AHORA + 2 * HORA)!.status).toBe('objected');
    expect(resolveDeletionVotes(e, [], AHORA + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });

  /** Y su pedido sigue venciendo: no se le rompe el trámite por no actualizar. */
  it('su pedido sigue venciendo a las 72hs', () => {
    const e = gasto([pideViejo('peer', AHORA)]);

    expect(resolveDeletionVotes(e, [], AHORA + DELETION_TIMEOUT_MS - 1)).toBe(false);
    expect(resolveDeletionVotes(e, [], AHORA + DELETION_TIMEOUT_MS + 1)).toBe(true);
  });

  /**
   * Lo que NO puede pasar: que la protección nueva le regale a un voto sin
   * `roundId` la capacidad de sobrevivir a una ronda posterior. Es el bug que
   * S7 cerró —un `delete` viejo volvía con las 72hs ya vencidas y el gasto se
   * borraba solo— y la poda por tiempo lo sigue tapando.
   */
  it('un voto suyo de la ronda anterior no revive contra un pedido nuevo', () => {
    const out = mergeDeletionVoteSets(
      [pide('yo', AHORA + 5 * HORA, 'rb')],
      [pideViejo('peer', AHORA), objetaViejo('peer', AHORA + HORA)],
    );

    expect(ids(out)).toEqual([`yo:delete:${AHORA + 5 * HORA}:rb`]);
    expect(deletionRound(gasto(out), AHORA + 6 * HORA)!.status).toBe('open');
  });
});

// ── 4. Convergencia ─────────────────────────────────────────────────────────

describe('convergencia con los dos relojes en el mismo conjunto', () => {
  const A = [pide('beto', AHORA, 'rb')];
  const B = [pide('ana', FUTURO, 'rf')];
  const C = [objetaViejo('caro', AHORA + HORA)];

  it('el orden de llegada no cambia el conjunto guardado', () => {
    const d1 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, B), C);
    const d2 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, C), B);
    const d3 = mergeDeletionVoteSets(C, mergeDeletionVoteSets(B, A));

    expect(ids(d1)).toEqual(ids(d2));
    expect(ids(d1)).toEqual(ids(d3));
    // Campo a campo y en el mismo orden: si el ORDEN difiere, el desempate
    // canónico del LWW elige distinto en cada teléfono.
    expect(d1).toEqual(d2);
    expect(d1).toEqual(d3);
  });

  it('y los dos dispositivos leen la MISMA ronda', () => {
    const d1 = mergeDeletionVoteSets(mergeDeletionVoteSets(A, B), C);
    const d2 = mergeDeletionVoteSets(C, mergeDeletionVoteSets(B, A));

    expect(deletionRound(gasto(d1), AHORA + 2 * HORA))
      .toEqual(deletionRound(gasto(d2), AHORA + 2 * HORA));
  });

  it('volver a mergear lo mismo no cambia nada', () => {
    const una = mergeDeletionVoteSets(A, B);
    expect(mergeDeletionVoteSets(una, B)).toEqual(una);
    expect(mergeDeletionVoteSets(una, A)).toEqual(una);
  });
});
