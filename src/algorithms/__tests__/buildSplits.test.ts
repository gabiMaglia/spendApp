import { buildSplits, calculateRemainder, validatePercentages } from '../buildSplits';

// Montos en menor unidad (ADR-002) — ej. $120,00 ARS → 12000.

// ── equal ────────────────────────────────────────────────────────────────────
describe('buildSplits — equal', () => {
  it('divides equally among 4 members (exact division)', () => {
    const splits = buildSplits(12000, ['a', 'b', 'c', 'd'], 'equal');
    expect(splits).toHaveLength(4);
    splits.forEach(s => expect(s.amount).toBe(3000));
    expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(12000);
  });

  it('deterministic remainder distribution by ascending userId (ADR-002 §4)', () => {
    // 10000 / 3 = 3333 resto 1 → el resto (1 unidad) va al primer userId
    // ascendente ('a'), no al último miembro del array de entrada.
    const splits = buildSplits(10000, ['c', 'a', 'b'], 'equal');
    const total = splits.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(10000); // Σ splits === total, EXACTO

    const byId = Object.fromEntries(splits.map(s => [s.userId, s.amount]));
    expect(byId.a).toBe(3334); // recibe el resto (userId más chico ascendente)
    expect(byId.b).toBe(3333);
    expect(byId.c).toBe(3333);
  });

  it('reparte el mismo resultado sin importar el orden de memberIds (reproducible P2P)', () => {
    const splitsOrderA = buildSplits(10000, ['c', 'a', 'b'], 'equal');
    const splitsOrderB = buildSplits(10000, ['a', 'b', 'c'], 'equal');
    const normalize = (splits: typeof splitsOrderA) =>
      Object.fromEntries(splits.map(s => [s.userId, s.amount]));
    expect(normalize(splitsOrderA)).toEqual(normalize(splitsOrderB));
  });

  it('handles a single member', () => {
    const splits = buildSplits(5000, ['only'], 'equal');
    expect(splits[0]!.amount).toBe(5000);
  });

  it('returns empty array for empty memberIds', () => {
    expect(buildSplits(10000, [], 'equal')).toHaveLength(0);
  });

  it('sets isPaid=false by default', () => {
    buildSplits(10000, ['a', 'b'], 'equal').forEach(s => expect(s.isPaid).toBe(false));
  });
});

// ── percentage ───────────────────────────────────────────────────────────────
describe('buildSplits — percentage', () => {
  it('calculates amounts from percentages', () => {
    const splits = buildSplits(20000, ['a', 'b'], 'percentage', [75, 25]);
    expect(splits[0]!.amount).toBe(15000);
    expect(splits[1]!.amount).toBe(5000);
    expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(20000);
  });

  it('handles uneven percentages', () => {
    const splits = buildSplits(10000, ['a', 'b', 'c'], 'percentage', [50, 30, 20]);
    expect(splits[0]!.amount).toBe(5000);
    expect(splits[1]!.amount).toBe(3000);
    expect(splits[2]!.amount).toBe(2000);
    expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(10000);
  });

  it('closes exactly when rounding does not add up (deterministic correction)', () => {
    // 10000 * 33.33% = 3333.0000...; 3 miembros con 33.33/33.33/33.34 →
    // el redondeo entero debe cerrar exacto contra el total.
    const splits = buildSplits(10000, ['a', 'b', 'c'], 'percentage', [33.33, 33.33, 33.34]);
    const total = splits.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(10000);
  });

  it('throws if values length does not match memberIds', () => {
    expect(() => buildSplits(10000, ['a', 'b'], 'percentage', [100])).toThrow();
  });

  it('throws if values is missing', () => {
    expect(() => buildSplits(10000, ['a', 'b'], 'percentage')).toThrow();
  });
});

// ── custom ───────────────────────────────────────────────────────────────────
describe('buildSplits — custom', () => {
  it('last member receives the remainder', () => {
    // Total $100,00: A pone $40,00, B pone $35,00 → C recibe $25,00
    const splits = buildSplits(10000, ['a', 'b', 'c'], 'custom', [4000, 3500]);
    expect(splits[0]!.amount).toBe(4000);
    expect(splits[1]!.amount).toBe(3500);
    expect(splits[2]!.amount).toBe(2500);
  });

  it('the sum of all splits equals the total exactly', () => {
    const splits = buildSplits(10000, ['a', 'b', 'c'], 'custom', [3300, 3300]);
    const total = splits.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(10000);
  });

  it('works with 2 members: last gets the rest', () => {
    const splits = buildSplits(10000, ['a', 'b'], 'custom', [6000]);
    expect(splits[0]!.amount).toBe(6000);
    expect(splits[1]!.amount).toBe(4000);
  });

  it('allows the last member to have a negative remainder (overshoot detection)', () => {
    // If others put more than the total, last gets a negative amount
    const splits = buildSplits(10000, ['a', 'b'], 'custom', [12000]);
    expect(splits[1]!.amount).toBe(-2000);
  });

  it('throws if values length is not memberIds.length - 1', () => {
    // For 3 members, need exactly 2 values
    expect(() => buildSplits(10000, ['a', 'b', 'c'], 'custom', [4000, 3500, 2500])).toThrow();
    expect(() => buildSplits(10000, ['a', 'b', 'c'], 'custom', [4000])).toThrow();
  });

  it('throws if values is missing', () => {
    expect(() => buildSplits(10000, ['a', 'b', 'c'], 'custom')).toThrow();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
describe('calculateRemainder', () => {
  it('returns total minus the sum of entered amounts', () => {
    expect(calculateRemainder(10000, [4000, 3500])).toBe(2500);
  });

  it('returns the full total when no amounts entered', () => {
    expect(calculateRemainder(10000, [])).toBe(10000);
  });

  it('returns negative when others exceed the total', () => {
    expect(calculateRemainder(10000, [6000, 6000])).toBe(-2000);
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
