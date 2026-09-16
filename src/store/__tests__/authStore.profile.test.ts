import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';
import type { User } from '@/src/types/models';

// El anon key real vive en el env de jest (igual que en producción), así que
// `getRelayClient()` no es null acá — sin este mock, `createClient` real de
// supabase-js intenta armar el socket de Realtime y explota en Node sin
// WebSocket nativo (pasa en la nube de EAS, no en toda versión de Node local).
// `jest.mock` se hoistea solo al tope del módulo, no hace falta escribirlo ahí.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signOut: async () => ({ error: null }),
      signInWithIdToken: async () => ({ error: null }),
    },
  }),
}));

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

  it('una sesión corrupta NO traba la app: hydrate degrada a "sin sesión"', () => {
    createSecureStorage('auth').set('current_user', '{roto');

    expect(() => useAuthStore.getState().hydrate()).not.toThrow();

    const s = useAuthStore.getState();
    expect(s.currentUser).toBeNull();
    expect(s.isLoading).toBe(false); // si quedara true, la app se traba en el splash
  });

  it('una sesión corrupta no se lleva puesto el perfil de la cuenta', () => {
    const auth = useAuthStore.getState();
    auth.setUser(appleUser({ name: 'Gabi' }));
    createSecureStorage('auth').set('current_user', '{roto');

    auth.hydrate();

    expect(auth.getStoredProfile(APPLE_ID)?.name).toBe('Gabi');
  });

  it('un perfil corrupto en storage se trata como inexistente, no rompe el login', () => {
    createSecureStorage('auth').set(`profile::u:${APPLE_ID}`, '{roto');
    expect(useAuthStore.getState().getStoredProfile(APPLE_ID)).toBeNull();
  });
});
