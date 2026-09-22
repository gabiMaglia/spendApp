import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AuthScreen from '@/app/auth/index';
import { useAuthStore, pendingGuestAccountId } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group } from '@/src/types/models';

/**
 * **T-101-bis: modo invitado.**
 *
 * Google Play no deja crear cuentas nuevas para revisar la app ni usar una cuenta
 * personal — y esta app sólo tiene login social. La salida (contemplada por el propio
 * formulario de Play: "modo invitado") es entrar sin ninguna cuenta: crea un `User`
 * local y usa la app entera, porque el buzón (`supabase/001_mailbox.sql`) acepta clave
 * `anon` y no depende de ningún proveedor.
 *
 * Si más tarde esa persona entra de verdad con Google/Apple, sus datos de invitado se
 * ofrecen para fusionar con `mergeAccounts` (el mismo mecanismo de T-042, cuando dos
 * proveedores resultan ser la misma persona) — nunca se pierden ni se pisan solos.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 1 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

let mockGoogleUser: { id: string; email: string; name?: string } | null = null;
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(() => Promise.resolve(
      mockGoogleUser ? { data: { user: mockGoogleUser, idToken: 'tok' } } : { data: { user: null } },
    )),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'cancel', IN_PROGRESS: 'in_progress' },
}));

jest.mock('@/src/sync/directoryAuth', () => ({
  signIntoDirectory: jest.fn(() => Promise.resolve({ ok: false })),
  signOutOfDirectory: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/src/sync/deviceKeys', () => ({ registerDeviceKey: jest.fn(() => Promise.resolve({ ok: false })) }));
jest.mock('@/src/services/avatar', () => ({ adoptarAvatarDelProveedor: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/src/store/miPerfil', () => ({ actualizarMiPerfil: jest.fn() }));

const grupo = (id: string, memberIds: string[]): Group => ({
  id, name: 'Viaje', memberIds, currency: 'ARS',
  createdAt: 0, createdById: memberIds[0], deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  createSecureStorage('auth').clearAll();
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: null, isPro: false, isLoading: false });
  useGroupStore.setState({ groups: [] });
  mockGoogleUser = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('modo invitado (T-101-bis)', () => {
  it('"Continuar sin cuenta" entra sin Google/Apple, con un perfil local', () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));

    const yo = useAuthStore.getState().currentUser;
    expect(yo).not.toBeNull();
    expect(yo!.authProvider).toBe('guest');
    expect(yo!.name).toBe('auth.guest_name');
  });

  it('registra la cuenta invitada como pendiente de fusión', () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));

    const guestId = useAuthStore.getState().currentUser!.id;
    expect(pendingGuestAccountId()).toBe(guestId);
  });

  it('sin haber sido invitado antes, el login de Google no pregunta nada de fusión', async () => {
    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    const r = render(<AuthScreen />);

    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(useAuthStore.getState().currentUser?.authProvider).toBe('google');
  });

  it('con datos de invitado pendientes, entrar con Google ofrece fusionarlos', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const guestId = useAuthStore.getState().currentUser!.id;
    useGroupStore.setState({ groups: [grupo('viaje1', [guestId])] });

    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });

    expect(Alert.alert).toHaveBeenCalledWith(
      'auth.guest_merge_title',
      expect.stringContaining('auth.guest_merge_body'),
      expect.any(Array),
    );
  });

  it('confirmar la fusión hace que la cuenta real reconozca los grupos del invitado como propios', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const guestId = useAuthStore.getState().currentUser!.id;
    useGroupStore.setState({ groups: [grupo('viaje1', [guestId])] });

    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });

    const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const sumar = cartel.find(b => b.text === 'auth.guest_merge_yes');
    act(() => { sumar!.onPress?.(); });

    // `mergeAccounts` no reescribe `memberIds` (D-6 de identityAlias.ts: ningún
    // registro se toca) — deja un alias, y es `esYo()` quien traduce al leer.
    expect(useGroupStore.getState().groups.some(g => g.id === 'viaje1' && g.memberIds.some(esYo))).toBe(true);
    expect(pendingGuestAccountId()).toBeNull();
  });

  it('rechazar la fusión no toca los datos pero no vuelve a preguntar', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const guestId = useAuthStore.getState().currentUser!.id;
    useGroupStore.setState({ groups: [grupo('viaje1', [guestId])] });

    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });

    const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const no = cartel.find(b => b.text === 'auth.guest_merge_no');
    act(() => { no!.onPress?.(); });

    expect(useGroupStore.getState().groups).toEqual([grupo('viaje1', [guestId])]);
    expect(pendingGuestAccountId()).toBeNull();
  });
});
