import { act, renderHook } from '@testing-library/react-native';

// Prefijo `mock`: es la excepción que permite babel-plugin-jest-hoist para
// referenciar variables de fuera del factory de `jest.mock` (si no, tira
// "module factory is not allowed to reference any out-of-scope variables").
let mockUrlInicial: string | null = null;
let mockEmitir: ((e: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => mockUrlInicial),
  addEventListener: jest.fn((_: string, cb: (e: { url: string }) => void) => {
    mockEmitir = cb;
    return { remove: jest.fn() };
  }),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/directoryAuth', () => ({ signOutOfDirectory: jest.fn(async () => {}) }));

import { useEnlacesEntrantes } from '@/src/hooks/useEnlacesEntrantes';
import { useAuthStore } from '@/src/store/authStore';
import { tomarEnlacePendiente, _reiniciarEnlacePendiente } from '@/src/utils/enlacePendiente';
import type { User } from '@/src/types/models';

const ana = { id: 'ua', name: 'Ana', email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false } as User;
const bob = { ...ana, id: 'ub', name: 'Bob' } as User;
const LINK = 'spendapp://contact/add?id=u9&name=Zoe';

beforeEach(() => {
  _reiniciarEnlacePendiente();
  mockUrlInicial = null;
  mockEmitir = null;
  useAuthStore.setState({ currentUser: null, isLoading: false });
});

async function montar() {
  const r = renderHook(() => useEnlacesEntrantes());
  await act(async () => {}); // resuelve getInitialURL
  return r;
}

describe('useEnlacesEntrantes (T-094 · SEC M-1)', () => {
  it('link con sesión → logout → login de OTRA cuenta: no se abre nada', async () => {
    useAuthStore.setState({ currentUser: ana });
    await montar();
    act(() => mockEmitir!({ url: LINK }));
    act(() => useAuthStore.setState({ currentUser: null }));
    act(() => useAuthStore.setState({ currentUser: bob }));
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('link sin sesión → login: se abre una vez', async () => {
    await montar();
    act(() => mockEmitir!({ url: LINK }));
    act(() => useAuthStore.setState({ currentUser: ana }));
    expect(tomarEnlacePendiente()).toBe('/contact/add?id=u9&name=Zoe');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('arranque en frío CON sesión guardada: espera la hidratación y no deja pendiente', async () => {
    mockUrlInicial = LINK;
    useAuthStore.setState({ currentUser: null, isLoading: true });
    await montar();
    act(() => useAuthStore.setState({ currentUser: ana, isLoading: false }));
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('arranque en frío SIN sesión: queda pendiente', async () => {
    mockUrlInicial = LINK;
    useAuthStore.setState({ currentUser: null, isLoading: true });
    await montar();
    act(() => useAuthStore.setState({ isLoading: false }));
    expect(tomarEnlacePendiente()).toBe('/contact/add?id=u9&name=Zoe');
  });
});
