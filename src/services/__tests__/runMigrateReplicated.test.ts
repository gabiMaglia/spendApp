import { migrarReplicadosUnaVez } from '@/src/services/runMigrateReplicated';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { createStorage } from '@/src/utils/createStorage';
import type { PersonalEntry, User } from '@/src/types/models';

const vieja = { id: 'u1', kind: 'group_replicated', description: 'x', amount: 1, currency: 'ARS',
  category: 'other', date: 0, createdAt: 0, updatedAt: 0, isDeleted: false } as PersonalEntry;

beforeEach(() => {
  createStorage('migrations').clearAll();
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  usePersonalStore.setState({ entries: [vieja] });
});

it('corre una vez y deja la réplica vieja con tombstone (T-229)', () => {
  expect(migrarReplicadosUnaVez()).toEqual({ corrio: true, borradas: 1 });
  expect(usePersonalStore.getState().entries[0]!.isDeleted).toBe(true);
  expect(migrarReplicadosUnaVez().corrio).toBe(false);
});
