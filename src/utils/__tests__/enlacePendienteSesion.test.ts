jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/directoryAuth', () => ({ signOutOfDirectory: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { recordarEnlace, tomarEnlacePendiente, _reiniciarEnlacePendiente } from '@/src/utils/enlacePendiente';

beforeEach(() => _reiniciarEnlacePendiente());

describe('cerrar sesión y el link pendiente (T-094)', () => {
  it('signOut descarta el link pendiente', () => {
    recordarEnlace('spendapp://contact/add?id=u1&name=Ada');
    useAuthStore.getState().signOut();
    expect(tomarEnlacePendiente()).toBeNull();
  });
});
