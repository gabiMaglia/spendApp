import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';
import type { User } from '@/src/types/models';

const APPLE_ID = 'apple:000123.abc';

function appleUser(over: Partial<User> = {}): User {
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

describe('authStore — el perfil de la cuenta sobrevive al signOut', () => {
  beforeEach(() => {
    createSecureStorage('auth').clearAll();
    useAuthStore.setState({ currentUser: null, isPro: false, isLoading: false });
  });

  it('signOut borra la sesión pero NO el perfil', () => {
    const auth = useAuthStore.getState();
    auth.setUser(appleUser());

    auth.signOut();

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(auth.getStoredProfile(APPLE_ID)?.name).toBe('Gabriel Maglia');
  });

  it('un nombre editado a mano queda persistido para el próximo login', () => {
    const auth = useAuthStore.getState();
    auth.setUser(appleUser());

    // Así edita el nombre la pantalla "Yo" (app/(tabs)/user.tsx).
    auth.setUser({ ...appleUser(), name: 'Gabi', updatedAt: 2_000 });
    auth.signOut();

    expect(auth.getStoredProfile(APPLE_ID)?.name).toBe('Gabi');
  });

  it('REGRESIÓN: 2º login con Apple (sin fullName ni email) conserva nombre y email', () => {
    const auth = useAuthStore.getState();
    auth.setUser(appleUser({ name: 'Gabi' }));
    auth.signOut();

    // Lo que Apple manda realmente la 2ª vez: todo null.
    const merged = mergeProviderUser(auth.getStoredProfile(APPLE_ID), {
      id: APPLE_ID, authProvider: 'apple', name: null, email: null,
    }, 9_000);
    auth.setUser(merged);

    const now = useAuthStore.getState().currentUser!;
    expect(now.name).toBe('Gabi');
    expect(now.email).toBe('gab.maglia@gmail.com');
    expect(now.createdAt).toBe(1_000);
  });

  it('no filtra el perfil de una cuenta a otra', () => {
    const auth = useAuthStore.getState();
    auth.setUser(appleUser());

    expect(auth.getStoredProfile('google:otra')).toBeNull();
  });

  it('un perfil corrupto en storage se trata como inexistente, no rompe el login', () => {
    createSecureStorage('auth').set(`profile::u:${APPLE_ID}`, '{roto');
    expect(useAuthStore.getState().getStoredProfile(APPLE_ID)).toBeNull();
  });
});
