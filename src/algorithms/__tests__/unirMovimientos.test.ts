import { unirMovimientos } from '@/src/algorithms/unirMovimientos';
import type { PersonalEntry } from '@/src/types/models';

const m = (id: string, over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id, kind: 'expense', description: id, amount: 100, currency: 'ARS', category: 'other',
  date: 1, createdAt: 1, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

describe('unirMovimientos (T-229)', () => {
  it('manuales y derivados juntos', () => {
    expect(unirMovimientos([m('a')], [m('rep_e1', { kind: 'group_replicated' })]).map(x => x.id))
      .toEqual(['a', 'rep_e1']);
  });

  it('mismo id guardado (congelado) y derivado: una sola vez, gana el derivado', () => {
    const r = unirMovimientos([m('rep_e1', { kind: 'group_replicated', amount: 1 })],
                              [m('rep_e1', { kind: 'group_replicated', amount: 2 })]);
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe(2);
  });

  it('los guardados borrados no aparecen', () => {
    expect(unirMovimientos([m('a', { isDeleted: true })], [])).toEqual([]);
  });

  it('una réplica vieja guardada (sin id rep_) se ignora', () => {
    expect(unirMovimientos([m('uuid-viejo', { kind: 'group_replicated' })], [])).toEqual([]);
  });

  it('un congelado sin fuente (grupo purgado) sigue apareciendo', () => {
    expect(unirMovimientos([m('pay_p1', { kind: 'payment_out' })], [])).toHaveLength(1);
  });
});
