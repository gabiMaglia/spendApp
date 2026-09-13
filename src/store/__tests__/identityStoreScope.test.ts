jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

import { useAuthStore } from '@/src/store/authStore';
import { listInvites, listPendingJoins, saveInvite, savePendingJoin } from '@/src/store/identityStore';
import type { User } from '@/src/types/models';

const cuenta = (id: string) => ({ id, name: id, email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false }) as User;
const inv = (token: string) => ({ groupId: 'g1', groupName: 'G', token, inviterFingerprint: 'cd'.repeat(16), expiresAt: Date.now() + 3_600_000 });

describe('invitaciones por cuenta (T-098 · SEC L-4)', () => {
  it('lo que emitió/aceptó la cuenta A no lo ve la cuenta B', () => {
    useAuthStore.setState({ currentUser: cuenta('A') });
    saveInvite(inv('aa'.repeat(32)));
    savePendingJoin(inv('bb'.repeat(32)));

    useAuthStore.setState({ currentUser: cuenta('B') });
    expect(listInvites()).toEqual([]);
    expect(listPendingJoins()).toEqual([]);

    useAuthStore.setState({ currentUser: cuenta('A') });
    expect(listInvites().map(i => i.token)).toEqual(['aa'.repeat(32)]);
    expect(listPendingJoins().map(i => i.token)).toEqual(['bb'.repeat(32)]);
  });
});
