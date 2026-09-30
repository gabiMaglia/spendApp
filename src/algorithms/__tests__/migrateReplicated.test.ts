import { planTombstoneReplicas } from '../migrateReplicated';
import type { PersonalEntry } from '@/src/types/models';

const m = (id: string, kind: PersonalEntry['kind'], isDeleted = false): PersonalEntry =>
  ({ id, kind, description: 'x', amount: 1, currency: 'ARS', category: 'other', date: 0,
     createdAt: 0, updatedAt: 0, isDeleted } as PersonalEntry);

describe('migración v2 de réplicas (T-229)', () => {
  it('tombstonea las réplicas viejas vivas (id uuid)', () => {
    expect(planTombstoneReplicas([m('u1', 'group_replicated'), m('u2', 'group_replicated')])).toEqual(['u1', 'u2']);
  });
  it('no toca los congelados (id rep_ / pay_), ni manuales, ni carryover, ni ya borradas', () => {
    expect(planTombstoneReplicas([
      m('rep_e1', 'group_replicated'), m('pay_p1', 'payment_out'), m('a', 'expense'),
      m('c', 'carryover'), m('u3', 'group_replicated', true),
    ])).toEqual([]);
  });
});
