import { useUserStore } from '../userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-188a · A5: `addOrUpdateUser` hace `{ ...previo, ...entrante }`, así que el
 * contrato del que depende `mergeProviderUser` (volver a entrar borra el
 * cartel «Cuenta borrada») es exactamente éste: una clave PRESENTE en
 * `undefined` pisa la previa; una clave AUSENTE la deja pasar. Si algún día se
 * reescribe `addOrUpdateUser` con otra estrategia de merge, este test tiene
 * que seguir pasando o la limpieza de `deletedAt` al re-loguear se rompe en
 * silencio.
 */

function user(over: Partial<User> = {}): User {
  return {
    id: 'u1', name: 'Gabriel', email: 'g@x.com', authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
    ...over,
  };
}

describe('userStore.addOrUpdateUser', () => {
  beforeEach(() => {
    createSecureStorage('users').clearAll();
    useUserStore.setState({ users: [] });
  });

  it('una clave PRESENTE en undefined pisa la previa (deletedAt se limpia)', () => {
    useUserStore.getState().addOrUpdateUser(user({ deletedAt: 5_000, name: 'Cuenta borrada' }));

    useUserStore.getState().addOrUpdateUser({ ...user(), deletedAt: undefined, name: 'Gabriel' });

    const u = useUserStore.getState().getUserById('u1')!;
    expect(u.deletedAt).toBeUndefined();
    expect(u.name).toBe('Gabriel');
  });

  it('una clave AUSENTE conserva la previa (no la resetea a undefined)', () => {
    useUserStore.getState().addOrUpdateUser(user({ avatarUrl: 'foto.png' }));

    const { avatarUrl: _omitida, ...sinAvatarUrl } = user({ name: 'Otro nombre' });
    useUserStore.getState().addOrUpdateUser(sinAvatarUrl as User);

    const u = useUserStore.getState().getUserById('u1')!;
    expect(u.avatarUrl).toBe('foto.png');
    expect(u.name).toBe('Otro nombre');
  });

  it('usuario nuevo: se agrega tal cual', () => {
    useUserStore.getState().addOrUpdateUser(user({ id: 'nuevo' }));
    expect(useUserStore.getState().getUserById('nuevo')).toBeDefined();
  });
});
