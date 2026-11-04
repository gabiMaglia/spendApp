import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AuthScreen from '@/app/auth/index';
import { useAuthStore, pendingGuestAccountId, invitadoDelAparato, forgetAccount, declineGuestMerge } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
import { subscribeSessionRehydrate } from '@/src/store/session';
import { flushScopedWrites } from '@/src/store/userScope';
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

jest.mock('@/src/sync/sesion/directoryAuth', () => ({
  signIntoDirectory: jest.fn(() => Promise.resolve({ ok: false })),
  signOutOfDirectory: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/src/sync/confianza/deviceKeys', () => ({ registerDeviceKey: jest.fn(() => Promise.resolve({ ok: false })) }));
jest.mock('@/src/services/avatar', () => ({ adoptarAvatarDelProveedor: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/src/store/miPerfil', () => ({ actualizarMiPerfil: jest.fn() }));

const grupo = (id: string, memberIds: string[]): Group => ({
  id, name: 'Viaje', memberIds, currency: 'ARS',
  // T-182: `memberIds` se deriva del roster al rehidratar, así que el fixture lo declara.
  miembros: Object.fromEntries(memberIds.map(m => [m, { estado: 'in' as const, at: 0 }])),
  createdAt: 0, createdById: memberIds[0], updatedAt: 0, isDeleted: false,
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
    // Persistido de verdad: tras fusionar, los stores se rehidratan desde disco.
    useGroupStore.getState().addGroup(grupo('viaje1', [guestId]));
    flushScopedWrites();

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

  // T-253: con la suscripción de sesión REAL montada (como en app/_layout), el
  // "Sí" tiene que dejar los stores en memoria con lo fusionado; si no, el
  // próximo guardado de cualquier store pisa la fusión con el estado vacío.
  it('«Sí, sumarlos» sobrevive a un guardado posterior (la sesión rehidrata tras fusionar)', async () => {
    const unsub = subscribeSessionRehydrate();
    try {
      const r = render(<AuthScreen />);
      fireEvent.press(r.getByText('auth.continue_guest'));
      const guestId = useAuthStore.getState().currentUser!.id;
      useGroupStore.getState().addGroup(grupo('viaje1', [guestId]));
      flushScopedWrites();

      mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
      await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
      const accountId = useAuthStore.getState().currentUser!.id;
      expect(useGroupStore.getState().groups).toHaveLength(0); // cuenta nueva, vacía

      const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
      await act(async () => { cartel.find(b => b.text === 'auth.guest_merge_yes')!.onPress?.(); });

      // El guardado posterior que antes pisaba la fusión.
      act(() => { useGroupStore.getState().addGroup(grupo('otro', [accountId])); });
      flushScopedWrites();

      expect(useGroupStore.getState().groups.map(g => g.id)).toEqual(expect.arrayContaining(['viaje1', 'otro']));
      const enDisco = createSecureStorage('groups').getString(`data_v1::u:${accountId}`) ?? '';
      expect(enDisco).toContain('viaje1');
      expect(esYo(guestId)).toBe(true);
    } finally { unsub(); }
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
    expect(invitadoDelAparato()).toBe(guestId);   // T-266: el puntero se conserva
  });
});

/**
 * T-266 · volver a entrar como invitado vuelve al MISMO invitado. La pantalla de
 * cierre promete «tus datos locales se conservan»; crear un id nuevo dejaba el
 * scope anterior inalcanzable. Una fila por estado de usuario.
 */
describe('T-266 · volver a entrar como invitado', () => {
  const cerrarSesion = () => act(() => { useAuthStore.getState().signOut(); });

  it('fila 1 · invitado sin datos: vuelve al mismo id', () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const id1 = useAuthStore.getState().currentUser!.id;
    cerrarSesion();

    fireEvent.press(r.getByText('auth.continue_guest'));
    expect(useAuthStore.getState().currentUser!.id).toBe(id1);
  });

  it('fila 2 · invitado con datos: vuelve al mismo id, a sus datos y a su perfil editado', () => {
    const unsub = subscribeSessionRehydrate();
    try {
      const r = render(<AuthScreen />);
      fireEvent.press(r.getByText('auth.continue_guest'));
      const yo = useAuthStore.getState().currentUser!;
      // La vía real de edición de perfil (la guarda de anunciarMiTarjeta prohíbe `setUser` suelto).
      const real = jest.requireActual('@/src/store/miPerfil') as typeof import('@/src/store/miPerfil');
      act(() => { real.actualizarMiPerfil({ name: 'Pepe' }); });
      useGroupStore.getState().addGroup(grupo('viaje1', [yo.id]));
      flushScopedWrites();
      cerrarSesion();
      expect(useGroupStore.getState().groups).toHaveLength(0);   // sesión cerrada: nada en memoria

      fireEvent.press(r.getByText('auth.continue_guest'));
      const vuelto = useAuthStore.getState().currentUser!;
      expect(vuelto.id).toBe(yo.id);
      expect(vuelto.name).toBe('Pepe');
      // O2: los stores se rehidratan en memoria, no sólo existen en disco.
      expect(useGroupStore.getState().groups.map(g => g.id)).toContain('viaje1');
    } finally { unsub(); }
  });

  it('fila 3 · invitado que ya fusionó: el siguiente invitado es uno NUEVO', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const guestId = useAuthStore.getState().currentUser!.id;
    useGroupStore.setState({ groups: [grupo('viaje1', [guestId])] });
    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    cerrarSesion();
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
    const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { cartel.find(b => b.text === 'auth.guest_merge_yes')!.onPress?.(); });
    cerrarSesion();

    fireEvent.press(r.getByText('auth.continue_guest'));
    expect(useAuthStore.getState().currentUser!.id).not.toBe(guestId);
  });

  it('fila 4 · cuenta Google sin invitado previo: «sin cuenta» crea un invitado nuevo', async () => {
    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    const r = render(<AuthScreen />);
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
    const cuenta = useAuthStore.getState().currentUser!.id;
    cerrarSesion();

    fireEvent.press(r.getByText('auth.continue_guest'));
    const yo = useAuthStore.getState().currentUser!;
    expect(yo.authProvider).toBe('guest');
    expect(yo.id).not.toBe(cuenta);
  });

  it('fila 5 · dijo «No» a la fusión: el scope no queda huérfano, se puede volver a él', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const guestId = useAuthStore.getState().currentUser!.id;
    useGroupStore.getState().addGroup(grupo('viaje1', [guestId]));
    flushScopedWrites();
    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    cerrarSesion();
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
    const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    act(() => { cartel.find(b => b.text === 'auth.guest_merge_no')!.onPress?.(); });

    expect(invitadoDelAparato()).toBe(guestId);
    expect(pendingGuestAccountId()).toBeNull();          // no se vuelve a preguntar
    cerrarSesion();
    fireEvent.press(r.getByText('auth.continue_guest'));
    expect(useAuthStore.getState().currentUser!.id).toBe(guestId);
    expect(pendingGuestAccountId()).toBe(guestId);        // vuelve a ser ofrecible
  });

  it('fila 5b · dijo «No» y entra de nuevo con la cuenta: no se vuelve a preguntar', async () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    mockGoogleUser = { id: 'g1', email: 'ana@x.com', name: 'Ana' };
    cerrarSesion();
    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
    const cartel = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    act(() => { cartel.find(b => b.text === 'auth.guest_merge_no')!.onPress?.(); });
    cerrarSesion();
    (Alert.alert as jest.Mock).mockClear();

    await act(async () => { fireEvent.press(r.getByText('auth.continue_google')); });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('fila 6 · invitado cuya cuenta se borró: el siguiente es uno NUEVO', () => {
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    const id1 = useAuthStore.getState().currentUser!.id;
    cerrarSesion();
    forgetAccount(id1);

    fireEvent.press(r.getByText('auth.continue_guest'));
    expect(useAuthStore.getState().currentUser!.id).not.toBe(id1);
  });

  it('fila 7 · declineGuestMerge sin invitado previo no deja marcas', () => {
    declineGuestMerge();
    expect(invitadoDelAparato()).toBeNull();
    const r = render(<AuthScreen />);
    fireEvent.press(r.getByText('auth.continue_guest'));
    expect(pendingGuestAccountId()).toBe(useAuthStore.getState().currentUser!.id);
  });
});
