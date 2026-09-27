import { useGroupStore } from '../groupStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

/**
 * T-182 (simplificado): `memberIds` es derivado de `miembros`
 * (`src/algorithms/roster.ts`). `updateGroup` es el único punto de escritura
 * genérico del store — nadie más debería poder colarle un `memberIds` a
 * mano, ni siquiera con buenas intenciones.
 */
const ADMIN = 'ua';
const MIEMBRO = 'ub';

function group(over: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: [ADMIN, MIEMBRO],
    miembros: { [ADMIN]: { estado: 'in', at: 0 }, [MIEMBRO]: { estado: 'in', at: 1 } },
    currency: 'ARS', createdAt: 0, createdById: ADMIN, deletionVotes: [],
    updatedAt: 1_000, isDeleted: false, ...over,
  } as Group;
}

describe('updateGroup rechaza un patch que trae memberIds directo', () => {
  const originalDev = (global as unknown as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    createSecureStorage('groups').clearAll();
    useAuthStore.setState({ currentUser: { id: ADMIN } as User });
    useGroupStore.setState({ groups: [group()], isLoading: false });
  });

  afterEach(() => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('en dev, tira en vez de aplicar el patch', () => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = true;
    expect(() => useGroupStore.getState().updateGroup('g1', { memberIds: [ADMIN] } as Partial<Group>))
      .toThrow();
    // el grupo no cambió
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual([ADMIN, MIEMBRO]);
  });

  it('un patch de miembros SÍ pasa y recalcula memberIds', () => {
    useGroupStore.getState().updateGroup('g1', {
      miembros: { [ADMIN]: { estado: 'in', at: 0 }, [MIEMBRO]: { estado: 'out', at: 5_000 } },
    });
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual([ADMIN]);
  });
});
