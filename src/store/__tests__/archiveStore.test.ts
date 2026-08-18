import { useArchiveStore } from '../archiveStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const ANA  = { id: 'ana',  name: 'Ana'  } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

function usar(u: User) {
  useAuthStore.setState({ currentUser: u });
  useArchiveStore.getState().hydrate();
}

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useArchiveStore.setState({ archivedIds: [] });
  usar(ANA);
});

describe('archivar grupos', () => {
  it('archiva y se nota', () => {
    useArchiveStore.getState().setArchived('g1', true);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
  });

  it('desarchiva', () => {
    useArchiveStore.getState().setArchived('g1', true);
    useArchiveStore.getState().setArchived('g1', false);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(false);
  });

  it('archivar dos veces no duplica', () => {
    useArchiveStore.getState().setArchived('g1', true);
    useArchiveStore.getState().setArchived('g1', true);
    expect(useArchiveStore.getState().archivedIds).toEqual(['g1']);
  });

  it('desarchivar algo que no estaba no rompe', () => {
    expect(() => useArchiveStore.getState().setArchived('nunca', false)).not.toThrow();
    expect(useArchiveStore.getState().archivedIds).toEqual([]);
  });

  it('sobrevive al reinicio', () => {
    useArchiveStore.getState().setArchived('g1', true);

    useArchiveStore.setState({ archivedIds: [] }); // como si arrancara la app
    useArchiveStore.getState().hydrate();

    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
  });

  // Archivar es MI vista: si viajara, sacaría el grupo de la lista del otro,
  // que quizá lo sigue usando para saldar.
  it('es personal: no se mezcla entre cuentas', () => {
    useArchiveStore.getState().setArchived('g1', true);

    usar(BETO);

    expect(useArchiveStore.getState().isArchived('g1')).toBe(false);
  });

  it('un dato corrupto se degrada a "ninguno archivado"', () => {
    createSecureStorage('groups').set('archived_v1::u:ana', 'no es json');
    useArchiveStore.getState().hydrate();

    expect(useArchiveStore.getState().archivedIds).toEqual([]);
  });
});
