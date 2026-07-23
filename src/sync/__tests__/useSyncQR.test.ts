import { buildDelta, applyDelta, deltaToQRString, parseDeltaFromQR } from '../useSyncQR';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Group, User } from '@/src/types/models';

const grp = (over: Partial<Group> & Pick<Group, 'id'>): Group => ({
  name: 'G', memberIds: ['me'], currency: 'ARS', createdAt: 0, createdById: 'me',
  deletionVotes: [], updatedAt: 100, isDeleted: false, ...over,
});
const usr = (id: string, over: Partial<User> = {}): User => ({
  id, name: id, email: '', authProvider: 'google', createdAt: 0, updatedAt: 100, isDeleted: false, ...over,
});

beforeEach(() => {
  useAuthStore.setState({ currentUser: usr('me') });
  useGroupStore.setState({ groups: [], isLoading: false });
  useExpenseStore.setState({ expenses: [], isLoading: false });
  usePaymentStore.setState({ payments: [], isLoading: false });
  useUserStore.setState({ users: [] });
});

describe('useSyncQR — buildDelta / applyDelta (LWW)', () => {
  it('buildDelta empaqueta el estado actual con version y fromUserId', () => {
    useGroupStore.setState({ groups: [grp({ id: 'g1' })], isLoading: false });
    const delta = buildDelta('me');
    expect(delta.version).toBe(1);
    expect(delta.fromUserId).toBe('me');
    expect(delta.groups.map(g => g.id)).toEqual(['g1']);
  });

  it('applyDelta: gana el registro más NUEVO (updatedAt mayor)', () => {
    useGroupStore.setState({ groups: [grp({ id: 'g1', name: 'viejo', updatedAt: 100 })], isLoading: false });
    applyDelta(
      { version: 1, fromUserId: 'peer', timestamp: 0, groups: [grp({ id: 'g1', name: 'nuevo', updatedAt: 200 })], expenses: [], payments: [], users: [] },
      'me',
    );
    expect(useGroupStore.getState().groups.find(g => g.id === 'g1')!.name).toBe('nuevo');
  });

  it('applyDelta: ignora el registro más VIEJO', () => {
    useGroupStore.setState({ groups: [grp({ id: 'g1', name: 'actual', updatedAt: 200 })], isLoading: false });
    applyDelta(
      { version: 1, fromUserId: 'peer', timestamp: 0, groups: [grp({ id: 'g1', name: 'obsoleto', updatedAt: 100 })], expenses: [], payments: [], users: [] },
      'me',
    );
    expect(useGroupStore.getState().groups.find(g => g.id === 'g1')!.name).toBe('actual');
  });

  it('applyDelta: un tombstone más nuevo propaga el borrado', () => {
    useGroupStore.setState({ groups: [grp({ id: 'g1', updatedAt: 100, isDeleted: false })], isLoading: false });
    applyDelta(
      { version: 1, fromUserId: 'peer', timestamp: 0, groups: [grp({ id: 'g1', updatedAt: 200, isDeleted: true })], expenses: [], payments: [], users: [] },
      'me',
    );
    expect(useGroupStore.getState().groups.find(g => g.id === 'g1')!.isDeleted).toBe(true);
  });

  it('applyDelta: NO pisa al currentUser con la versión del peer', () => {
    useUserStore.setState({ users: [usr('me', { name: 'Yo real', updatedAt: 500 })] });
    applyDelta(
      { version: 1, fromUserId: 'peer', timestamp: 0, groups: [], expenses: [], payments: [],
        users: [usr('me', { name: 'Yo pisado', updatedAt: 999 }), usr('peer', { name: 'Peer' })] },
      'me',
    );
    const me = useUserStore.getState().users.find(u => u.id === 'me')!;
    expect(me.name).toBe('Yo real');               // no lo pisó pese al updatedAt mayor
    expect(useUserStore.getState().users.some(u => u.id === 'peer')).toBe(true); // sí sumó al peer
  });

  it('deltaToQRString / parseDeltaFromQR: roundtrip', () => {
    useGroupStore.setState({ groups: [grp({ id: 'g1' })], isLoading: false });
    const parsed = parseDeltaFromQR(deltaToQRString(buildDelta('me')));
    expect(parsed.groups.map(g => g.id)).toEqual(['g1']);
  });

  it('parseDeltaFromQR: rechaza una versión no soportada', () => {
    expect(() => parseDeltaFromQR(JSON.stringify({ version: 2 }))).toThrow();
  });
});
