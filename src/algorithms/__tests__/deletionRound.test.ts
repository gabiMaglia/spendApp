import { deletionRound, msUntilDeletion, hasObjected, hasRequested } from '../deletionRound';
import { DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import type { DeletionVote, Expense } from '@/src/types/models';

const AHORA = Date.UTC(2026, 7, 17, 12);

const gasto = (votes: DeletionVote[]): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false,
} as Expense);

const pide     = (userId: string, at = AHORA): DeletionVote => ({ userId, votedAt: at, action: 'delete' });
const objeta   = (userId: string, at = AHORA): DeletionVote => ({ userId, votedAt: at, action: 'cancel' });

describe('ronda de borrado', () => {
  it('sin votos no hay ronda', () => {
    expect(deletionRound(gasto([]))).toBeNull();
  });

  it('un gasto sin el campo tampoco rompe', () => {
    expect(deletionRound({ ...gasto([]), deletionVotes: undefined as any })).toBeNull();
  });

  it('un pedido abre la ronda y fija el vencimiento a 72hs', () => {
    const r = deletionRound(gasto([pide('beto')]))!;

    expect(r.requestedBy).toBe('beto');
    expect(r.expiresAt).toBe(AHORA + DELETION_TIMEOUT_MS);
    expect(r.objected).toBe(false);
  });

  // El plazo cuenta desde el PRIMER pedido: es desde cuándo la gente tuvo aviso.
  it('con dos pedidos manda el más viejo', () => {
    const r = deletionRound(gasto([pide('beto', AHORA + 5000), pide('caro', AHORA)]))!;

    expect(r.requestedBy).toBe('caro');
    expect(r.requestedAt).toBe(AHORA);
  });

  it('una objeción mata la ronda y se sabe quién fue', () => {
    const r = deletionRound(gasto([pide('beto'), objeta('caro')]))!;

    expect(r.objected).toBe(true);
    expect(r.objectedBy).toBe('caro');
  });

  it('el último voto de cada persona es el que vale', () => {
    // Caro objetó y después se arrepintió y pidió el borrado.
    const r = deletionRound(gasto([pide('beto'), objeta('caro', AHORA), pide('caro', AHORA + 1000)]))!;

    expect(r.objected).toBe(false);
  });
});

describe('cuánto falta', () => {
  it('cuenta hacia atrás', () => {
    const r = deletionRound(gasto([pide('beto')]))!;
    expect(msUntilDeletion(r, AHORA + 3600_000)).toBe(DELETION_TIMEOUT_MS - 3600_000);
  });

  it('nunca es negativo', () => {
    const r = deletionRound(gasto([pide('beto')]))!;
    expect(msUntilDeletion(r, AHORA + DELETION_TIMEOUT_MS * 2)).toBe(0);
  });
});

describe('quién hizo qué', () => {
  it('reconoce a quien pidió y a quien objetó', () => {
    const e = gasto([pide('beto'), objeta('caro')]);

    expect(hasRequested(e, 'beto')).toBe(true);
    expect(hasObjected(e, 'caro')).toBe(true);
    expect(hasObjected(e, 'beto')).toBe(false);
    expect(hasRequested(e, 'caro')).toBe(false);
  });
});
