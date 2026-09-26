import { resolveDeletionVotes, DELETION_TIMEOUT_MS } from '../SyncEngine';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * SEC-01 (T-142b / T-143). Hasta acá el override del creador «se honraba
 * verifique su firma o no» (R3). Un miembro cualquiera publicaba
 * `{ userId: <creador>, forced: true }` SIN firma y el gasto se borraba en
 * todos los teléfonos al instante — la regla #2 (72 h de consenso) se vaciaba
 * por el canal de sync. Ahora un `forced` sólo es inmediato si quien lo llama
 * dice que su firma cierra; si no, es un pedido de borrado como cualquier otro.
 */
const NOW = 1_790_000_000_000;

const gasto = (votes: DeletionVote[]): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', splits: [], splitMode: 'equal', category: 'food',
  date: NOW - 1000, createdAt: NOW - 1000, createdById: 'ana',
  deletionVotes: votes, updatedAt: NOW - 1000, isDeleted: false,
} as Expense);

const forcedSinFirma: DeletionVote = { userId: 'ana', votedAt: NOW - 10, action: 'delete', forced: true };
const forcedFirmado: DeletionVote = { ...forcedSinFirma, k: 'aa'.repeat(32), s: 'bb'.repeat(64) };

describe('SEC-01 · un `forced` a nombre del creador sin firma que cierre', () => {
  it('NO borra al instante (el PoC SEC-A pasa a rojo)', () => {
    expect(resolveDeletionVotes(gasto([forcedSinFirma]), ['ana', 'mallory'], NOW)).toBe(false);
  });

  it('sin verificador inyectado, el default es no confiar en ningún forced', () => {
    expect(resolveDeletionVotes(gasto([forcedFirmado]), [], NOW)).toBe(false);
  });

  it('se degrada a un pedido normal: vence a las 72 h si nadie objeta', () => {
    // El voto se emitió en NOW - 10: el vencimiento se cuenta desde ESE
    // `votedAt`, no desde NOW.
    const e = gasto([forcedSinFirma]);
    expect(resolveDeletionVotes(e, [], forcedSinFirma.votedAt + DELETION_TIMEOUT_MS - 1, () => false)).toBe(false);
    expect(resolveDeletionVotes(e, [], forcedSinFirma.votedAt + DELETION_TIMEOUT_MS + 1, () => false)).toBe(true);
  });

  it('y una objeción lo frena, como a cualquier pedido', () => {
    const objeta: DeletionVote = { userId: 'beto', votedAt: NOW, action: 'cancel' };
    const e = gasto([forcedSinFirma, objeta]);
    expect(resolveDeletionVotes(e, [], NOW + DELETION_TIMEOUT_MS * 2, () => false)).toBe(false);
  });
});

describe('SEC-01 · un `forced` cuya firma SÍ cierra sigue siendo inmediato (R3)', () => {
  const confia = (v: DeletionVote) => v.k !== undefined && v.s !== undefined;

  it('borra al instante', () => {
    expect(resolveDeletionVotes(gasto([forcedFirmado]), [], NOW, confia)).toBe(true);
  });

  it('y un restore posterior lo deshace, como antes', () => {
    const restaura: DeletionVote = { userId: 'beto', votedAt: NOW, action: 'cancel', intent: 'restore' };
    expect(resolveDeletionVotes(gasto([forcedFirmado, restaura]), [], NOW + 1, confia)).toBe(false);
  });

  it('el predicado se consulta sólo para el voto del creador, nunca para los demás', () => {
    const espia = jest.fn(() => true);
    const pideBeto: DeletionVote = { userId: 'beto', votedAt: NOW, action: 'delete' };
    resolveDeletionVotes(gasto([forcedFirmado, pideBeto]), [], NOW, espia);
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ana', forced: true }));
  });
});
