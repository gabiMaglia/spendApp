import { SyncEngine, mergeDeletionVotes, resolveDeletionVotes } from '../SyncEngine';
import type { Expense, SyncMeta } from '@/src/types/models';

interface TestRecord extends SyncMeta { value: string }

function rec(id: string, updatedAt: number, isDeleted = false, value = 'v'): TestRecord {
  return { id, updatedAt, isDeleted, value };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    updatedAt: 1000,
    isDeleted: false,
    groupId: 'g1',
    description: 'Test',
    amount: 100,
    currency: 'ARS',
    paidById: 'u1',
    splits: [],
    splitMode: 'equal',
    category: 'other',
    date: 1000,
    createdAt: 1000,
    createdById: 'u1',
    deletionVotes: [],
    ...overrides,
  };
}

describe('SyncEngine.mergeData', () => {
  const engine = new SyncEngine();

  it('keeps local record when there is no remote version', () => {
    const result = engine.mergeData([rec('a', 100)], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('prefers remote record when remote updatedAt is higher', () => {
    const result = engine.mergeData([rec('a', 100, false, 'local')], [rec('a', 200, false, 'remote')]);
    expect(result[0]!.value).toBe('remote');
  });

  it('prefers local record when local updatedAt is higher', () => {
    const result = engine.mergeData([rec('a', 200, false, 'local')], [rec('a', 100, false, 'remote')]);
    expect(result[0]!.value).toBe('local');
  });

  it('propagates isDeleted=true when remote tombstone wins', () => {
    const result = engine.mergeData(
      [rec('a', 100, false, 'alive')],
      [rec('a', 200, true,  'deleted')],
    );
    expect(result[0]!.isDeleted).toBe(true);
  });

  it('does not resurrect a deleted record when local tombstone wins', () => {
    const result = engine.mergeData(
      [rec('a', 200, true, 'deleted')],
      [rec('a', 100, false, 'alive')],
    );
    expect(result[0]!.isDeleted).toBe(true);
  });

  it('merges records from both sides without duplicates', () => {
    const result = engine.mergeData([rec('a', 100), rec('b', 100)], [rec('c', 100)]);
    expect(result).toHaveLength(3);
  });
});

describe('SyncEngine.buildDelta', () => {
  const engine = new SyncEngine();

  it('returns only records newer than peerLastSync', () => {
    const records = [rec('a', 100), rec('b', 200), rec('c', 300)];
    const delta = engine.buildDelta(records, 150);
    expect(delta.map(r => r.id).sort()).toEqual(['b', 'c']);
  });

  it('returns empty array when nothing is newer', () => {
    const delta = engine.buildDelta([rec('a', 100)], 500);
    expect(delta).toHaveLength(0);
  });
});

describe('mergeDeletionVotes', () => {
  it('keeps the most recent vote per user', () => {
    const votes = [
      { userId: 'u1', votedAt: 100, action: 'delete' as const },
      { userId: 'u1', votedAt: 200, action: 'cancel' as const },
    ];
    const result = mergeDeletionVotes(votes);
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe('cancel');
  });

  it('keeps votes from different users', () => {
    const votes = [
      { userId: 'u1', votedAt: 100, action: 'delete' as const },
      { userId: 'u2', votedAt: 100, action: 'delete' as const },
    ];
    expect(mergeDeletionVotes(votes)).toHaveLength(2);
  });
});

describe('resolveDeletionVotes', () => {
  it('returns false when there are no votes', () => {
    const expense = makeExpense({ deletionVotes: [] });
    expect(resolveDeletionVotes(expense, ['u1', 'u2'])).toBe(false);
  });

  it('returns true immediately when creator forces deletion', () => {
    const expense = makeExpense({
      createdById: 'creator',
      deletionVotes: [{ userId: 'creator', votedAt: Date.now(), action: 'delete', forced: true }],
    });
    expect(resolveDeletionVotes(expense, ['creator', 'u2'])).toBe(true);
  });

  it('returns false when any member cancels', () => {
    const expense = makeExpense({
      createdById: 'creator',
      deletionVotes: [
        { userId: 'creator', votedAt: Date.now(), action: 'delete' },
        { userId: 'u2',      votedAt: Date.now(), action: 'cancel' },
      ],
    });
    expect(resolveDeletionVotes(expense, ['creator', 'u2'])).toBe(false);
  });

  it('returns false when 72hs have NOT passed since delete vote', () => {
    const expense = makeExpense({
      deletionVotes: [{ userId: 'u1', votedAt: Date.now() - 1000, action: 'delete' }],
    });
    expect(resolveDeletionVotes(expense, ['u1', 'u2'])).toBe(false);
  });

  it('returns true when 72hs have passed and no one cancelled', () => {
    const OVER_72H = 73 * 60 * 60 * 1000;
    const expense = makeExpense({
      deletionVotes: [{ userId: 'u1', votedAt: Date.now() - OVER_72H, action: 'delete' }],
    });
    expect(resolveDeletionVotes(expense, ['u1', 'u2'])).toBe(true);
  });
});
