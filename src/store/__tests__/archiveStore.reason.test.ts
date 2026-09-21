import { useArchiveStore } from '../archiveStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const ANA = { id: 'ana', name: 'Ana' } as User;

// `readScoped`/`writeScoped` (src/store/userScope.ts) sólo leen/escriben con
// un usuario activo — igual que en archiveStore.test.ts, sin esto hydrate()
// no tiene de dónde recuperar nada.
beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('archiveStore — por qué se archivó cada grupo', () => {
  it('archivar sin razón explícita cae en "manual" (no rompe al swipe-to-archive existente)', () => {
    useArchiveStore.getState().setArchived('g1', true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('manual');
    expect(useArchiveStore.getState().canUnarchive('g1')).toBe(true);
  });

  it('archivar con reason "limit" queda irrevocable', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
    expect(useArchiveStore.getState().canUnarchive('g1')).toBe(false);
  });

  it('desarchivar un "limit" no hace nada — sigue archivado', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    useArchiveStore.getState().setArchived('g1', false);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
  });

  it('desarchivar un "manual" funciona igual que hoy', () => {
    useArchiveStore.getState().setArchived('g1', true);
    useArchiveStore.getState().setArchived('g1', false);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(false);
    expect(useArchiveStore.getState().archiveReason('g1')).toBeNull();
  });

  it('un grupo nunca archivado no tiene razón', () => {
    expect(useArchiveStore.getState().archiveReason('nunca')).toBeNull();
    expect(useArchiveStore.getState().canUnarchive('nunca')).toBe(true);
  });

  it('hydrate recupera archivedIds Y reasons persistidos', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    useArchiveStore.getState().setArchived('g2', true);
    useArchiveStore.setState({ archivedIds: [], reasons: {} });

    useArchiveStore.getState().hydrate();

    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
    expect(useArchiveStore.getState().archiveReason('g2')).toBe('manual');
  });

  it('un storage corrupto de reasons degrada a vacío, no tira (mismo criterio que T-020)', () => {
    createSecureStorage('groups').set('archived_reasons_v1', '{roto');
    expect(() => useArchiveStore.getState().hydrate()).not.toThrow();
    expect(useArchiveStore.getState().archiveReason('cualquiera')).toBeNull();
  });
});
