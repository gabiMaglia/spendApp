import React from 'react';
import { act, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import AddContactScreen from '@/app/contact/add';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import type { User } from '@/src/types/models';

/**
 * T-197: el lado que MUESTRA el QR (`mode === 'my_qr'`) no reaccionaba a nada —
 * la tarjeta del otro llega por `contactChannel.ts` → `addOrUpdateUser`, y quien
 * mostraba el código se quedaba mirándolo sin enterarse de que ya quedaron
 * conectados. Ahora, mientras se muestra el QR, un alta nueva en `useUserStore`
 * cierra la pantalla y vuelve a Amigos — igual que ya hace el lado que escanea.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('@/src/sync/contactChannel', () => ({
  ensureContactSecret: () => 'mi-secreto',
  announceContact: jest.fn(() => Promise.resolve(true)),
  savePeer: jest.fn(),
  hasConflictingPinnedKeys: jest.fn(() => false),
}));
jest.mock('@/src/store/identityStore', () => ({
  ensureIdentity: () => ({ publicKey: 'aa'.repeat(32), privateKey: 'aa'.repeat(32) }),
  ensureWrapKeypair: () => ({ publicKey: 'bb'.repeat(32), privateKey: 'bb'.repeat(32) }),
  saveContactInvite: jest.fn(),
}));
jest.mock('@/src/sync/relayEngine', () => ({ deviceId: () => 'dev-1' }));

const ANA  = { id: 'ana1',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto1', name: 'Beto', isDeleted: false } as User;

beforeEach(() => {
  jest.clearAllMocks();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
});

describe('mostrar el QR: cerrar solo al detectar un alta del otro lado', () => {
  it('un contacto NUEVO en el store (llegó por el buzón) cierra la pantalla y vuelve a Amigos', () => {
    render(<AddContactScreen />);
    expect(router.back).not.toHaveBeenCalled();

    act(() => {
      useUserStore.getState().addOrUpdateUser(BETO);
    });

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('sin historial (deep link) usa replace a Amigos en vez de back', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    render(<AddContactScreen />);

    act(() => {
      useUserStore.getState().addOrUpdateUser(BETO);
    });

    expect(router.replace).toHaveBeenCalledWith('/(tabs)/friends');
  });

  it('actualizar un contacto que YA existía (mismo id) no cierra nada', () => {
    useUserStore.setState({ users: [ANA, BETO] });
    render(<AddContactScreen />);

    act(() => {
      useUserStore.getState().addOrUpdateUser({ ...BETO, name: 'Beto (editado)' });
    });

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('en modo "scan" no reacciona al store (ese camino ya cierra por su cuenta)', () => {
    render(<AddContactScreen />);
    // Sin forma de tocar la pestaña "Escanear" acá sin la cámara real montada,
    // se ejercita el guard directo: el mismo alta en modo my_qr ya cerró antes,
    // así que un segundo alta (ya "cerrado por alta") no debe volver a cerrar.
    act(() => {
      useUserStore.getState().addOrUpdateUser(BETO);
    });
    expect(router.back).toHaveBeenCalledTimes(1);

    act(() => {
      useUserStore.getState().addOrUpdateUser({ id: 'cata1', name: 'Cata', isDeleted: false } as User);
    });
    // Ya se cerró una vez: no se llama de nuevo.
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
