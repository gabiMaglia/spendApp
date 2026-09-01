import { emitirVoto } from '../deletionVotes';
import { deletionRound } from '@/src/algorithms/deletionRound';
import { mergeDeletionVoteSets, resolveDeletionVotes } from '@/src/sync/SyncEngine';
import { verifyVote } from '@/src/sync/voteSign';
import { accionDe } from '@/src/sync/voteCore';
import { ensureIdentity } from '@/src/store/identityStore';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **Lo que EMITE cada acción** (T-041 · S8).
 *
 * La invariante que gobierna todo el archivo, y que S7 pagó caro para
 * descubrir: **frenar es AGREGAR un voto, nunca sacar los que hay.** Desde el
 * merge por niveles el conjunto se une, y una ausencia no se distingue de un
 * voto que todavía no llegó: un vaciado vuelve del primer peer que sincronice,
 * y vuelve con su `votedAt` original —las 72hs ya vencidas— así que el gasto se
 * borra solo. Cada acción nueva de S8 tiene que respetarla.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const T0 = Date.UTC(2026, 8, 1, 12);
const HORA = 3_600_000;
/** Cuándo LEE la app: después de todos los votos del archivo (T-059). */
const LEIDO = T0 + 6 * HORA;

const gasto = (votes: DeletionVote[], over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto', 'caro'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const mio = (votos: DeletionVote[], userId: string) => votos.find(v => v.userId === userId)!;

describe('cada acción emite el enunciado que le corresponde', () => {
  it('pedir abre una ronda nueva, con su `roundId`', () => {
    const votos = emitirVoto(gasto([]), 'beto', 'delete', T0);

    expect(votos).toHaveLength(1);
    expect(accionDe(votos[0]!)).toBe('delete');
    expect(votos[0]!.roundId).toBeTruthy();
    expect(votos[0]!.forced).toBeUndefined();
  });

  it('forzar es un pedido con el override del creador', () => {
    const votos = emitirVoto(gasto([]), 'ana', 'force', T0);

    expect(accionDe(votos[0]!)).toBe('delete');
    expect(votos[0]!.forced).toBe(true);
  });

  it.each([
    ['object',   'object'],
    ['withdraw', 'withdraw'],
    ['restore',  'restore'],
  ] as const)('%s emite su propia acción, contra la ronda vigente', (accion, esperada) => {
    const abierto = emitirVoto(gasto([]), 'beto', 'delete', T0);
    const votos = emitirVoto(gasto(abierto), 'caro', accion, T0 + HORA);

    expect(accionDe(mio(votos, 'caro'))).toBe(esperada);
    expect(mio(votos, 'caro').roundId).toBe(abierto[0]!.roundId);
  });

  /**
   * Objetar y restaurar viajan los dos como `cancel`: un peer que no actualizó
   * sólo conoce ese token, y una acción que no conoce es un voto que no frena
   * nada — el gasto se borraría solo allá y el tombstone volvería por el sync.
   */
  it('objetar y restaurar viajan como `cancel` para el que no actualizó', () => {
    const abierto = emitirVoto(gasto([]), 'beto', 'delete', T0);

    expect(mio(emitirVoto(gasto(abierto), 'caro', 'object', T0 + HORA), 'caro').action).toBe('cancel');
    expect(mio(emitirVoto(gasto(abierto), 'caro', 'restore', T0 + HORA), 'caro').action).toBe('cancel');
  });
});

describe('ninguna acción frena SACANDO votos', () => {
  const abierto = emitirVoto(gasto([]), 'beto', 'delete', T0);
  const conDos = [...abierto, ...emitirVoto(gasto(abierto), 'dana', 'object', T0 + HORA).filter(v => v.userId === 'dana')];

  it.each(['object', 'withdraw', 'restore'] as const)('%s conserva los votos ajenos', accion => {
    const salida = emitirVoto(gasto(conDos), 'caro', accion, T0 + 2 * HORA);

    for (const previo of conDos) expect(salida).toContainEqual(previo);
    expect(salida.length).toBe(conDos.length + 1);
  });

  it('retirar el pedido propio no toca el pedido de otra persona', () => {
    const dosPedidos = [...abierto, ...emitirVoto(gasto(abierto), 'caro', 'delete', T0 + HORA).filter(v => v.userId === 'caro')];
    // `caro` reabrió: su pedido es el de la ronda vigente. Beto retira el suyo.
    const salida = emitirVoto(gasto(dosPedidos), 'beto', 'withdraw', T0 + 2 * HORA);

    expect(salida.filter(v => v.userId === 'caro' && accionDe(v) === 'delete')).toHaveLength(1);
    expect(deletionRound(gasto(salida), LEIDO)!.status).toBe('open');
  });
});

describe('lo que se emite viaja firmado', () => {
  const clave = () => ensureIdentity().publicKey;

  it.each(['delete', 'force', 'object', 'withdraw', 'restore'] as const)('%s', accion => {
    const abierto = emitirVoto(gasto([]), 'beto', 'delete', T0);
    const votos = emitirVoto(gasto(abierto), 'caro', accion, T0 + HORA);

    expect(verifyVote('e1', mio(votos, 'caro'), [clave()])).toBe('valida');
  });

  it('un voto ajeno se conserva tal cual: no lo re-firmo con MI clave', () => {
    const ajeno: DeletionVote = { userId: 'beto', votedAt: T0, action: 'delete', roundId: 'r1', k: 'ff', s: 'ee' };
    const salida = emitirVoto(gasto([ajeno]), 'caro', 'object', T0 + HORA);

    expect(mio(salida, 'beto')).toEqual(ajeno);
  });
});

describe('convergencia: el orden de llegada no cambia el resultado', () => {
  const pedido = emitirVoto(gasto([]), 'beto', 'delete', T0);
  const conObjecion = emitirVoto(gasto(pedido), 'caro', 'object', T0 + HORA);
  const conRetiro = emitirVoto(gasto(pedido), 'beto', 'withdraw', T0 + 2 * HORA);

  const huella = (vs: DeletionVote[]) =>
    vs.map(v => `${v.userId}:${accionDe(v)}:${v.votedAt}`).sort().join('|');

  it('dos dispositivos que reciben lo mismo en distinto orden terminan iguales', () => {
    const uno = mergeDeletionVoteSets(mergeDeletionVoteSets(pedido, conObjecion), conRetiro);
    const dos = mergeDeletionVoteSets(mergeDeletionVoteSets(conRetiro, conObjecion), pedido);
    const tres = mergeDeletionVoteSets(conObjecion, mergeDeletionVoteSets(conRetiro, pedido));

    expect(huella(uno)).toBe(huella(dos));
    expect(huella(uno)).toBe(huella(tres));
    expect(deletionRound(gasto(uno), LEIDO)?.status).toBe(deletionRound(gasto(dos), LEIDO)?.status);
  });

  /**
   * Y el caso que S7 cerró, ahora con las acciones nuevas: el pedido viejo
   * vuelve del peer que no lo vio retirar, y NO puede resucitar el borrado.
   */
  it('un pedido que vuelve de otro peer no revive el borrado retirado', () => {
    const unido = mergeDeletionVoteSets(conRetiro, pedido);
    expect(resolveDeletionVotes(gasto(unido), [], T0 + 10 * 24 * HORA)).toBe(false);
  });

  it('ni el restaurado', () => {
    const forzado = emitirVoto(gasto([]), 'ana', 'force', T0);
    const restaurado = emitirVoto(gasto(forzado), 'beto', 'restore', T0 + HORA);
    const unido = mergeDeletionVoteSets(restaurado, forzado);

    expect(resolveDeletionVotes(gasto(unido), [], T0 + 10 * 24 * HORA)).toBe(false);
    expect(deletionRound(gasto(unido), LEIDO)!.status).toBe('restored');
  });
});
