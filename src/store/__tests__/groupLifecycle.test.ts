import { useGroupStore } from '../groupStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

const ADMIN = 'ua';
const MIEMBRO = 'ub';

function group(over: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: [ADMIN, MIEMBRO], currency: 'ARS',
    createdAt: 0, createdById: ADMIN, deletionVotes: [],
    updatedAt: 1_000, isDeleted: false, ...over,
  } as Group;
}

describe('eliminar y salir de un grupo', () => {
  beforeEach(() => {
    createSecureStorage('groups').clearAll();
    useAuthStore.setState({ currentUser: { id: ADMIN } as User });
    useGroupStore.setState({ groups: [], isLoading: false });
  });

  describe('eliminar (admin)', () => {
    it('marca tombstone, no borra físico', () => {
      useGroupStore.getState().addGroup(group());
      useGroupStore.getState().deleteGroup('g1');

      const g = useGroupStore.getState().getById('g1');
      expect(g).toBeDefined();
      expect(g!.isDeleted).toBe(true);
    });

    // Sin tombstone el otro device reintroduciría el grupo en el próximo merge.
    it('el borrado le gana a la versión vieja del otro dispositivo', () => {
      useGroupStore.getState().addGroup(group({ updatedAt: 1_000 }));
      useGroupStore.getState().deleteGroup('g1');

      useGroupStore.getState().mergeGroups([group({ updatedAt: 1_000 })]);

      expect(useGroupStore.getState().getById('g1')!.isDeleted).toBe(true);
    });

    it('refresca updatedAt para que el borrado se propague', () => {
      useGroupStore.getState().addGroup(group({ updatedAt: 1_000 }));
      useGroupStore.getState().deleteGroup('g1');

      expect(useGroupStore.getState().getById('g1')!.updatedAt).toBeGreaterThan(1_000);
    });
  });

  describe('salir (cualquiera)', () => {
    it('me saca de memberIds sin borrar el grupo', () => {
      useGroupStore.getState().addGroup(group());
      useGroupStore.getState().leaveGroup('g1', MIEMBRO);

      const g = useGroupStore.getState().getById('g1')!;
      expect(g.isDeleted).toBe(false);
      expect(g.memberIds).toEqual([ADMIN]);
    });

    // Irse no es lo mismo que no haber estado: las deudas siguen existiendo.
    it('el grupo sigue vivo para los que quedan', () => {
      useGroupStore.getState().addGroup(group());
      useGroupStore.getState().leaveGroup('g1', MIEMBRO);

      expect(useGroupStore.getState().getById('g1')!.memberIds).toContain(ADMIN);
    });

    it('salir dos veces no rompe ni duplica', () => {
      useGroupStore.getState().addGroup(group());
      useGroupStore.getState().leaveGroup('g1', MIEMBRO);
      useGroupStore.getState().leaveGroup('g1', MIEMBRO);

      expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual([ADMIN]);
    });

    it('el admin también puede salir sin eliminar', () => {
      useGroupStore.getState().addGroup(group());
      useGroupStore.getState().leaveGroup('g1', ADMIN);

      const g = useGroupStore.getState().getById('g1')!;
      expect(g.memberIds).toEqual([MIEMBRO]);
      expect(g.isDeleted).toBe(false);
    });

    it('refresca updatedAt para que la salida se propague', () => {
      useGroupStore.getState().addGroup(group({ updatedAt: 1_000 }));
      useGroupStore.getState().leaveGroup('g1', MIEMBRO);

      expect(useGroupStore.getState().getById('g1')!.updatedAt).toBeGreaterThan(1_000);
    });
  });
});

describe('el modo de borrado no se afloja por sync', () => {
  beforeEach(() => {
    createSecureStorage('groups').clearAll();
    useAuthStore.setState({ currentUser: { id: ADMIN } as User });
    useGroupStore.setState({ groups: [], isLoading: false });
  });

  // El Group viaja ENTERO en el sobre y el merge es LWW: un miembro que manda
  // el grupo con `deletionMode: 'open'` y un `updatedAt` mayor ganaba, y desde
  // ahí borraba gastos ajenos al instante. Vaciaba la regla #2 por el sync.
  it('un miembro NO puede pasar mi grupo de consensuado a libre', () => {
    useGroupStore.getState().addGroup(group({ deletionMode: 'consensus', updatedAt: 1_000 }));

    useGroupStore.getState().mergeGroups([
      group({ deletionMode: 'open', name: 'Viaje editado', updatedAt: 9_999 }),
    ]);

    const g = useGroupStore.getState().getById('g1')!;
    expect(g.deletionMode).toBe('consensus');
    // El resto del merge sigue funcionando: sólo el modo queda congelado.
    expect(g.name).toBe('Viaje editado');
  });

  it('un grupo que llega por primera vez SÍ trae su modo', () => {
    useGroupStore.getState().mergeGroups([group({ id: 'g2', deletionMode: 'open' })]);
    expect(useGroupStore.getState().getById('g2')!.deletionMode).toBe('open');
  });
});
