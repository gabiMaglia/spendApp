import { SyncEngine } from '../SyncEngine';
import type { SyncMeta } from '@/src/types/models';

interface TestRecord extends SyncMeta { value: string }

function rec(id: string, updatedAt: number, isDeleted = false, value = 'v'): TestRecord {
  return { id, updatedAt, isDeleted, value };
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

