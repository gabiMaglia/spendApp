import { mergeProviderUser, FALLBACK_USER_NAME } from '../mergeProviderUser';
import type { User } from '@/src/types/models';

const APPLE_ID = 'apple:000123.abc';

function storedUser(over: Partial<User> = {}): User {
  return {
    id:           APPLE_ID,
    name:         'Gabriel Maglia',
    email:        'gab.maglia@gmail.com',
    authProvider: 'apple',
    createdAt:    1_000,
    updatedAt:    1_000,
    isDeleted:    false,
    ...over,
  };
}

describe('mergeProviderUser', () => {
  describe('primer login (no hay nada guardado)', () => {
    it('toma los datos del proveedor', () => {
      const u = mergeProviderUser(null, {
        id: APPLE_ID, authProvider: 'apple',
        name: 'Gabriel Maglia', email: 'gab.maglia@gmail.com',
      }, 5_000);

      expect(u.name).toBe('Gabriel Maglia');
      expect(u.email).toBe('gab.maglia@gmail.com');
      expect(u.createdAt).toBe(5_000);
    });

    it('cae al nombre de relleno si el proveedor no manda nada', () => {
      const u = mergeProviderUser(null, { id: 'x', authProvider: 'google' }, 5_000);
      expect(u.name).toBe(FALLBACK_USER_NAME);
      expect(u.email).toBe('');
    });
  });

  describe('re-login (el caso que rompía)', () => {
    // Apple manda fullName/email SOLO la primera vez. Antes de este merge,
    // el 2º login los pisaba con 'Usuario' y ''.
    it('conserva nombre y email cuando el proveedor manda null', () => {
      const u = mergeProviderUser(storedUser(), {
        id: APPLE_ID, authProvider: 'apple', name: null, email: null,
      }, 9_000);

      expect(u.name).toBe('Gabriel Maglia');
      expect(u.email).toBe('gab.maglia@gmail.com');
    });

    it('conserva el nombre que el usuario editó a mano, aunque el proveedor mande otro', () => {
      const u = mergeProviderUser(storedUser({ name: 'Gabi' }), {
        id: APPLE_ID, authProvider: 'apple', name: 'Gabriel Maglia', email: null,
      }, 9_000);

      expect(u.name).toBe('Gabi');
    });

    it('no resetea createdAt', () => {
      const u = mergeProviderUser(storedUser({ createdAt: 1_000 }), {
        id: APPLE_ID, authProvider: 'apple',
      }, 9_000);

      expect(u.createdAt).toBe(1_000);
      expect(u.updatedAt).toBe(9_000);
    });

    it('trata el nombre de relleno como "sin dato" y deja que el proveedor lo mejore', () => {
      const u = mergeProviderUser(storedUser({ name: FALLBACK_USER_NAME }), {
        id: APPLE_ID, authProvider: 'apple', name: 'Gabriel Maglia',
      }, 9_000);

      expect(u.name).toBe('Gabriel Maglia');
    });

    it('ignora strings vacíos o de solo espacios del proveedor', () => {
      const u = mergeProviderUser(storedUser(), {
        id: APPLE_ID, authProvider: 'apple', name: '   ', email: '',
      }, 9_000);

      expect(u.name).toBe('Gabriel Maglia');
      expect(u.email).toBe('gab.maglia@gmail.com');
    });

    it('deja ganar al proveedor en el avatar (no es editable por el usuario)', () => {
      const u = mergeProviderUser(storedUser({ avatarUrl: 'viejo.png' }), {
        id: APPLE_ID, authProvider: 'google', avatarUrl: 'nuevo.png',
      }, 9_000);

      expect(u.avatarUrl).toBe('nuevo.png');
    });
  });

  describe('cuenta distinta', () => {
    it('NO arrastra datos de otra cuenta cuando el id no coincide', () => {
      const u = mergeProviderUser(storedUser(), {
        id: 'google:otro', authProvider: 'google', name: 'Otra Persona',
      }, 9_000);

      expect(u.id).toBe('google:otro');
      expect(u.name).toBe('Otra Persona');
      expect(u.email).toBe('');
      expect(u.createdAt).toBe(9_000);
    });
  });
});
