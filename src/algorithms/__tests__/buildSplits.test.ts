import { buildSplits, calculateRemainder, validatePercentages } from '../buildSplits';

// ── equal ────────────────────────────────────────────────────────────────────
describe('buildSplits — equal', () => {
  it('divides equally among 4 members', () => {
    const splits = buildSplits(120, ['a', 'b', 'c', 'd'], 'equal');
    expect(splits).toHaveLength(4);
    splits.forEach(s => expect(s.amount).toBe(30));
  });

  it('last member absorbs rounding difference', () => {
    // 100 / 3 = 33.33... → last member gets 33.34
    const splits = buildSplits(100, ['a', 'b', 'c'], 'equal');
    const total = splits.reduce((s, x) => s + x.amount, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });

  it('handles a single member', () => {
    const splits = buildSplits(50, ['only'], 'equal');
    expect(splits[0]!.amount).toBe(50);
  });

  it('returns empty array for empty memberIds', () => {
    expect(buildSplits(100, [], 'equal')).toHaveLength(0);
  });

  it('sets isPaid=false by default', () => {
    buildSplits(100, ['a', 'b'], 'equal').forEach(s => expect(s.isPaid).toBe(false));
  });
});

// ── percentage ───────────────────────────────────────────────────────────────
describe('buildSplits — percentage', () => {
  it('calculates amounts from percentages', () => {
    const splits = buildSplits(200, ['a', 'b'], 'percentage', [75, 25]);
    expect(splits[0]!.amount).toBe(150);
    expect(splits[1]!.amount).toBe(50);
  });

  it('handles uneven percentages', () => {
    const splits = buildSplits(100, ['a', 'b', 'c'], 'percentage', [50, 30, 20]);
    expect(splits[0]!.amount).toBe(50);
    expect(splits[1]!.amount).toBe(30);
    expect(splits[2]!.amount).toBe(20);
  });

  it('throws if values length does not match memberIds', () => {
    expect(() => buildSplits(100, ['a', 'b'], 'percentage', [100])).toThrow();
  });

  it('throws if values is missing', () => {
    expect(() => buildSplits(100, ['a', 'b'], 'percentage')).toThrow();
  });
});

// ── custom ───────────────────────────────────────────────────────────────────
describe('buildSplits — custom', () => {
  it('last member receives the remainder', () => {
    // Total $100: A puts $40, B puts $35 → C gets $25
    const splits = buildSplits(100, ['a', 'b', 'c'], 'custom', [40, 35]);
    expect(splits[0]!.amount).toBe(40);
    expect(splits[1]!.amount).toBe(35);
    expect(splits[2]!.amount).toBe(25);
  });

  it('the sum of all splits equals the total', () => {
    const splits = buildSplits(100, ['a', 'b', 'c'], 'custom', [33, 33]);
    const total = splits.reduce((s, x) => s + x.amount, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });

  it('works with 2 members: last gets the rest', () => {
    const splits = buildSplits(100, ['a', 'b'], 'custom', [60]);
    expect(splits[0]!.amount).toBe(60);
    expect(splits[1]!.amount).toBe(40);
  });

  it('allows the last member to have a negative remainder (overshoot detection)', () => {
    // If others put more than the total, last gets a negative amount
    const splits = buildSplits(100, ['a', 'b'], 'custom', [120]);
    expect(splits[1]!.amount).toBe(-20);
  });

  it('throws if values length is not memberIds.length - 1', () => {
    // For 3 members, need exactly 2 values
    expect(() => buildSplits(100, ['a', 'b', 'c'], 'custom', [40, 35, 25])).toThrow();
    expect(() => buildSplits(100, ['a', 'b', 'c'], 'custom', [40])).toThrow();
  });

  it('throws if values is missing', () => {
    expect(() => buildSplits(100, ['a', 'b', 'c'], 'custom')).toThrow();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
describe('calculateRemainder', () => {
  it('returns total minus the sum of entered amounts', () => {
    expect(calculateRemainder(100, [40, 35])).toBe(25);
  });

  it('returns the full total when no amounts entered', () => {
    expect(calculateRemainder(100, [])).toBe(100);
  });

  it('returns negative when others exceed the total', () => {
    expect(calculateRemainder(100, [60, 60])).toBe(-20);
  });
});

describe('validatePercentages', () => {
  it('returns true when percentages sum to 100', () => {
    expect(validatePercentages([50, 30, 20])).toBe(true);
  });

  it('returns true with floating point near 100', () => {
    expect(validatePercentages([33.33, 33.33, 33.34])).toBe(true);
  });

  it('returns false when percentages do not sum to 100', () => {
    expect(validatePercentages([40, 30])).toBe(false);
  });
});
