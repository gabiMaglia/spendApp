import React from 'react';
import { render } from '@testing-library/react-native';
import { AccountReconnectHost } from '../AccountReconnectHost';
import { requestReconnect } from '@/src/sync/accountReconnectBridge';

const mockConfigure = jest.fn((_opts?: unknown) => {});
const mockHasPreviousSignIn = jest.fn(() => false);
const mockSignInSilently = jest.fn();
const mockSignIn = jest.fn();
const mockHasPlayServices = jest.fn(async (_opts?: unknown) => true);
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...a: unknown[]) => mockConfigure(...a),
    hasPreviousSignIn: () => mockHasPreviousSignIn(),
    signInSilently: () => mockSignInSilently(),
    signIn: () => mockSignIn(),
    hasPlayServices: (...a: unknown[]) => mockHasPlayServices(...a),
  },
}));

const mockSignInAsync = jest.fn(async (_opts?: unknown) => ({ identityToken: null as string | null }));
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...a: unknown[]) => mockSignInAsync(...a),
  AppleAuthenticationScope: { EMAIL: 'email' },
}));

beforeEach(() => {
  mockConfigure.mockClear();
  mockHasPreviousSignIn.mockClear().mockReturnValue(false);
  mockSignInSilently.mockClear();
  mockSignIn.mockClear();
  mockHasPlayServices.mockClear();
  mockSignInAsync.mockClear();
});

function montar() {
  return render(<AccountReconnectHost />);
}

it('configura Google al montar', () => {
  montar();
  expect(mockConfigure).toHaveBeenCalled();
});

describe('Google', () => {
  it('silencioso sin sesión previa → not_available, sin llamar signInSilently', async () => {
    mockHasPreviousSignIn.mockReturnValue(false);
    montar();
    await expect(requestReconnect('google', 'silent')).resolves.toEqual({ status: 'not_available' });
    expect(mockSignInSilently).not.toHaveBeenCalled();
  });

  it('silencioso con sesión previa → ok con el idToken', async () => {
    mockHasPreviousSignIn.mockReturnValue(true);
    mockSignInSilently.mockResolvedValue({ type: 'success', data: { idToken: 'tok-silente' } });
    montar();
    await expect(requestReconnect('google', 'silent')).resolves.toEqual({ status: 'ok', idToken: 'tok-silente' });
  });

  it('silencioso que no encuentra credencial guardada → not_available', async () => {
    mockHasPreviousSignIn.mockReturnValue(true);
    mockSignInSilently.mockResolvedValue({ type: 'noSavedCredentialFound', data: null });
    montar();
    await expect(requestReconnect('google', 'silent')).resolves.toEqual({ status: 'not_available' });
  });

  it('interactivo abre el flujo real de Google', async () => {
    mockSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok-interactivo' } });
    montar();
    await expect(requestReconnect('google', 'interactive')).resolves.toEqual({ status: 'ok', idToken: 'tok-interactivo' });
    expect(mockHasPlayServices).toHaveBeenCalled();
  });

  it('interactivo cancelado → failed', async () => {
    mockSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    montar();
    await expect(requestReconnect('google', 'interactive')).resolves.toEqual({ status: 'failed' });
  });
});

describe('Apple', () => {
  it('nunca reconecta en silencio', async () => {
    montar();
    await expect(requestReconnect('apple', 'silent')).resolves.toEqual({ status: 'not_available' });
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });

  it('interactivo abre el diálogo nativo', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'tok-apple' });
    montar();
    await expect(requestReconnect('apple', 'interactive')).resolves.toEqual({ status: 'ok', idToken: 'tok-apple' });
  });

  it('sin identityToken → failed', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });
    montar();
    await expect(requestReconnect('apple', 'interactive')).resolves.toEqual({ status: 'failed' });
  });
});

it('sin host montado, no hay a quién pedirle nada', async () => {
  await expect(requestReconnect('google', 'silent')).resolves.toEqual({ status: 'not_available' });
});

it('al desmontar deja de atender', async () => {
  const { unmount } = montar();
  unmount();
  await expect(requestReconnect('google', 'silent')).resolves.toEqual({ status: 'not_available' });
});
