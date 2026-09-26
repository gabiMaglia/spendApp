import { useExpenseStore } from '../expenseStore';
import { useGroupStore } from '../groupStore';
import { applyDelta, type SyncDelta } from '@/src/sync/useSyncQR';
import type { Expense, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

/**
 * T-144 (SEC-02), por los caminos reales: relay y QR comparten `applyDelta`
 * y ninguno pasa `now`, así que el tope depende del default `syncedNow()`
 * fijado en cada store — como `mergeUsersFuturoStore.test.ts` para perfiles.
 */
const NOW = Date.now();

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: 0,
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, ...over,
} as Expense);

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS', deletionMode: 'consensus',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, ...over,
} as Group);

const delta = (parte: Partial<SyncDelta>): SyncDelta => ({
  version: 1, fromUserId: 'mallory', timestamp: NOW,
  groups: [], expenses: [], payments: [], users: [], ...parte,
} as SyncDelta);

beforeEach(() => {
  useExpenseStore.setState({ expenses: [gasto()] });
  useGroupStore.setState({ groups: [grupo()] });
});

it('un tombstone con updatedAt 9e15 que llega por applyDelta no borra el gasto', () => {
  applyDelta(delta({ expenses: [gasto({ isDeleted: true, updatedAt: 9e15 })] }), 'ana');
  expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
});

it('una expulsión con updatedAt 9e15 que llega por applyDelta no saca a nadie', () => {
  applyDelta(delta({ groups: [grupo({ memberIds: ['mallory'], updatedAt: 9e15 })] }), 'ana');
  expect(useGroupStore.getState().groups[0]!.memberIds).toEqual(['ana', 'beto']);
});

it('con `now` inyectado explícito el store obedece ese reloj', () => {
  useExpenseStore.getState().mergeExpenses([gasto({ isDeleted: true, updatedAt: 9e15 })], NOW);
  expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
});

describe('la estampa propia sana lo envenenado y nunca empata', () => {
  it('updateExpense sobre un registro envenenado vuelve a un updatedAt plausible', () => {
    useExpenseStore.setState({ expenses: [gasto({ updatedAt: 9e15 })] });
    useExpenseStore.getState().updateExpense('e1', { description: 'Cena arreglada' });
    const u = useExpenseStore.getState().expenses[0]!.updatedAt;
    expect(u).toBeLessThan(9e15);
    expect(u).toBeGreaterThanOrEqual(NOW - 1000);
  });

  it('dos updateExpense seguidos dan updatedAt estrictamente crecientes', () => {
    useExpenseStore.getState().updateExpense('e1', { description: 'a' });
    const u1 = useExpenseStore.getState().expenses[0]!.updatedAt;
    useExpenseStore.getState().updateExpense('e1', { description: 'b' });
    const u2 = useExpenseStore.getState().expenses[0]!.updatedAt;
    expect(u2).toBeGreaterThan(u1);
  });
});
