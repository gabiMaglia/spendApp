jest.mock('../accountReconnectBridge', () => ({ requestReconnect: jest.fn() }));
jest.mock('../directoryAuth', () => ({ signIntoDirectory: jest.fn() }));

import { reconectarCuentaInteractivo } from '../accountReconnect';
import { useAuthStore } from '@/src/store/authStore';
import { requestReconnect } from '../accountReconnectBridge';
import { signIntoDirectory } from '../directoryAuth';
import type { User } from '@/src/types/models';

const mockRequestReconnect = requestReconnect as jest.Mock;
const mockSignIntoDirectory = signIntoDirectory as jest.Mock;

beforeEach(() => {
  mockRequestReconnect.mockReset();
  mockSignIntoDirectory.mockReset();
});

it('sin usuario, no hace nada', async () => {
  useAuthStore.setState({ currentUser: null });
  expect(await reconectarCuentaInteractivo()).toBe(false);
  expect(mockRequestReconnect).not.toHaveBeenCalled();
});

it('invitado no reconecta (no es una cuenta)', async () => {
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
  expect(await reconectarCuentaInteractivo()).toBe(false);
  expect(mockRequestReconnect).not.toHaveBeenCalled();
});

it('cuenta Google: pide el token interactivo y lo entrega al directorio', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'ok', idToken: 'tok' });
  mockSignIntoDirectory.mockResolvedValue({ ok: true });

  expect(await reconectarCuentaInteractivo()).toBe(true);

  expect(mockRequestReconnect).toHaveBeenCalledWith('google', 'interactive');
  expect(mockSignIntoDirectory).toHaveBeenCalledWith('google', 'tok');
});

it('si el proveedor no da token, no llama al directorio', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'failed' });

  expect(await reconectarCuentaInteractivo()).toBe(false);
  expect(mockSignIntoDirectory).not.toHaveBeenCalled();
});

it('si el directorio rechaza, devuelve false', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'ok', idToken: 'tok' });
  mockSignIntoDirectory.mockResolvedValue({ ok: false, reason: 'rejected' });

  expect(await reconectarCuentaInteractivo()).toBe(false);
});
