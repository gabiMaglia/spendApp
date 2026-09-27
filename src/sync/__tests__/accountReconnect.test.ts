jest.mock('../accountReconnectBridge', () => ({ requestReconnect: jest.fn() }));
jest.mock('../directoryAuth', () => ({ signIntoDirectory: jest.fn() }));
jest.mock('../relaySession', () => ({ validarIdentidadReconectada: jest.fn() }));

import { reconectarCuentaInteractivo } from '../accountReconnect';
import { useAuthStore } from '@/src/store/authStore';
import { requestReconnect } from '../accountReconnectBridge';
import { signIntoDirectory } from '../directoryAuth';
import { validarIdentidadReconectada } from '../relaySession';
import type { User } from '@/src/types/models';

const mockRequestReconnect = requestReconnect as jest.Mock;
const mockSignIntoDirectory = signIntoDirectory as jest.Mock;
const mockValidar = validarIdentidadReconectada as jest.Mock;

beforeEach(() => {
  mockRequestReconnect.mockReset();
  mockSignIntoDirectory.mockReset();
  mockValidar.mockReset().mockResolvedValue('ok');
});

it('sin usuario, no hace nada', async () => {
  useAuthStore.setState({ currentUser: null });
  expect(await reconectarCuentaInteractivo()).toBe('failed');
  expect(mockRequestReconnect).not.toHaveBeenCalled();
});

it('invitado no reconecta (no es una cuenta)', async () => {
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
  expect(await reconectarCuentaInteractivo()).toBe('failed');
  expect(mockRequestReconnect).not.toHaveBeenCalled();
});

it('cuenta Google: pide el token interactivo, lo entrega al directorio y valida la identidad', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'ok', idToken: 'tok' });
  mockSignIntoDirectory.mockResolvedValue({ ok: true });

  expect(await reconectarCuentaInteractivo()).toBe('ok');

  expect(mockRequestReconnect).toHaveBeenCalledWith('google', 'interactive');
  expect(mockSignIntoDirectory).toHaveBeenCalledWith('google', 'tok');
  expect(mockValidar).toHaveBeenCalledWith('acc1');
});

it('si el proveedor no da token, no llama al directorio', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'failed' });

  expect(await reconectarCuentaInteractivo()).toBe('failed');
  expect(mockSignIntoDirectory).not.toHaveBeenCalled();
});

it('si el directorio rechaza, devuelve failed', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'ok', idToken: 'tok' });
  mockSignIntoDirectory.mockResolvedValue({ ok: false, reason: 'rejected' });

  expect(await reconectarCuentaInteractivo()).toBe('failed');
});

/**
 * Verifier R4-1(a) (ronda 4): «Reconectar» con Google abre un SELECTOR de
 * cuentas — nada impide que el usuario elija una distinta de la activa. El
 * `idToken` que vuelve no se comprueba antes de `signIntoDirectory`
 * (`accountReconnect.ts` no lo hacía), así que la sesión podía quedar
 * indefinidamente con el uid equivocado. Ahora se valida DESPUÉS del login
 * (`validarIdentidadReconectada`, `relaySession.ts`) y, si no coincide, se
 * devuelve un resultado DISTINGUIBLE (`'otra_cuenta'`) para poder avisarle
 * al usuario en vez de aceptarla en silencio.
 */
it('R4-1(a): si eligió otra cuenta, devuelve "otra_cuenta" (no "ok")', async () => {
  useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
  mockRequestReconnect.mockResolvedValue({ status: 'ok', idToken: 'tok-de-otra-cuenta' });
  mockSignIntoDirectory.mockResolvedValue({ ok: true });
  mockValidar.mockResolvedValue('otra_cuenta');

  expect(await reconectarCuentaInteractivo()).toBe('otra_cuenta');
});
