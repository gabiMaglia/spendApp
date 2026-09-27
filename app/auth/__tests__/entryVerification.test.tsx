/**
 * T-147 (fila 9a/9b de la retro, decisión del PO 2026-09-27): "Entrar como
 * invitado" y el login de Google/Apple tienen que pedir la verificación
 * bloqueante (`entryGateStore` → 'pendiente') ANTES/junto con `setUser` —
 * es lo que hace que `AuthGuard` mande a `/auth/verify` en vez de directo a
 * las tabs.
 */
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({
      data: { user: { id: 'google-uid-1', email: 'persona@example.com', name: 'Persona' }, idToken: 'id-token-google' },
    })),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' },
}));

jest.mock('expo-apple-authentication', () => {
  const { Pressable, Text } = require('react-native');
  return {
    isAvailableAsync: jest.fn(async () => true),
    signInAsync: jest.fn(async () => ({
      user: 'apple-uid-1', email: 'persona@icloud.com', fullName: { givenName: 'Persona', familyName: null },
      identityToken: 'id-token-apple',
    })),
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => (
      <Pressable testID="apple-button" onPress={onPress}><Text>apple</Text></Pressable>
    ),
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 1 },
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  };
});

jest.mock('@/src/sync/directoryAuth', () => ({ signIntoDirectory: jest.fn(async () => ({ ok: false })) }));
jest.mock('@/src/sync/deviceKeys', () => ({ registerDeviceKey: jest.fn(async () => {}) }));
jest.mock('@/src/services/avatar', () => ({ adoptarAvatarDelProveedor: jest.fn(async () => null) }));

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import AuthScreen from '../index';
import { useAuthStore } from '@/src/store/authStore';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';

beforeEach(() => {
  __resetEntryGate();
  useAuthStore.setState({ currentUser: null });
});

it('fila 9a: "Entrar como invitado" pide la verificación (gate → pendiente)', async () => {
  const { getByText } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByText('auth.continue_guest')); });

  expect(useAuthStore.getState().currentUser?.authProvider).toBe('guest');
  expect(useEntryGateStore.getState().estado).toBe('pendiente');
});

it('fila 9b: login de Google (cuenta nueva) pide la verificación (gate → pendiente)', async () => {
  const { getByText } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByText('auth.continue_google')); });
  await act(async () => {}); // deja correr los awaits internos de accountIdFor/setUser

  expect(useAuthStore.getState().currentUser?.authProvider).toBe('google');
  expect(useEntryGateStore.getState().estado).toBe('pendiente');
});

it('fila 9b: login de Apple (cuenta nueva) pide la verificación (gate → pendiente)', async () => {
  const { getByTestId } = render(<AuthScreen />);
  await act(async () => {}); // deja resolver `isAvailableAsync` (useEffect) para que el botón nativo aparezca
  await act(async () => { fireEvent.press(getByTestId('apple-button')); });
  await act(async () => {});

  expect(useAuthStore.getState().currentUser?.authProvider).toBe('apple');
  expect(useEntryGateStore.getState().estado).toBe('pendiente');
});
