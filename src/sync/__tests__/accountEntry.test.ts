/**
 * T-147-b (`engram/plans/T-147.md`, Task 3, sellado por el PO 2026-09-27):
 * reconexión de cuenta para el buzón — filas 4 (Google silencioso), 5
 * (Apple/fallback interactivo) y 6 (rechazo de otra cuenta) de la tabla.
 *
 * Se descarta el Arbitraje P-2 (`accountReconnect`, botón «Reconectar»,
 * 17 estados): acá el contrato es chico a propósito — dos funciones, cada
 * una devuelve un resultado cerrado, y NUNCA tocan la red si la identidad no
 * coincide primero.
 */
const mockSignInSilently = jest.fn();
const mockSignIn = jest.fn();
const mockHasPlayServices = jest.fn(async (..._args: unknown[]) => true);
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signInSilently: (...a: unknown[]) => mockSignInSilently(...a),
    signIn: (...a: unknown[]) => mockSignIn(...a),
    hasPlayServices: (...a: unknown[]) => mockHasPlayServices(...a),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...a: unknown[]) => mockSignInAsync(...a),
  AppleAuthenticationScope: { EMAIL: 'EMAIL' },
}));

const mockEsYo = jest.fn((_id: string) => true);
jest.mock('@/src/store/identityAlias', () => ({ esYo: (id: string) => mockEsYo(id) }));

const mockMarcarProveedorProbado = jest.fn();
jest.mock('@/src/store/authStore', () => ({ marcarProveedorProbado: (p: string) => mockMarcarProveedorProbado(p) }));

const mockSignIntoDirectory = jest.fn();
jest.mock('../directoryAuth', () => ({ signIntoDirectory: (...a: unknown[]) => mockSignIntoDirectory(...a) }));

const mockRegisterDeviceKey = jest.fn();
jest.mock('../deviceKeys', () => ({ registerDeviceKey: () => mockRegisterDeviceKey() }));

import { reconectarGoogleSilencioso, reconectarInteractivo } from '../accountEntry';

beforeEach(() => {
  jest.clearAllMocks();
  mockEsYo.mockReturnValue(true);
  mockSignIntoDirectory.mockResolvedValue({ ok: true });
  mockHasPlayServices.mockResolvedValue(true);
});

describe('fila 4 · reconexión SILENCIOSA de Google', () => {
  it('sin credencial guardada → failed/no_credential, sin tocar la red', async () => {
    mockSignInSilently.mockResolvedValue({ type: 'noSavedCredentialFound', data: null });
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'failed', reason: 'no_credential' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
  });

  it('credencial propia con idToken → ok, entra al directorio y marca el proveedor probado', async () => {
    mockSignInSilently.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-google-1' }, idToken: 'idtok-1' } });
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'ok' });
    expect(mockSignIntoDirectory).toHaveBeenCalledWith('google', 'idtok-1');
    expect(mockMarcarProveedorProbado).toHaveBeenCalledWith('sub-google-1');
    expect(mockRegisterDeviceKey).toHaveBeenCalled();
  });

  /**
   * Fila 6: el `sub` no es una identidad mía (ni directa ni alias T-048) →
   * rechazo, NADA se guarda — ni siquiera se intenta `signIntoDirectory`.
   */
  it('credencial de OTRA cuenta → other_account, nada guardado', async () => {
    mockEsYo.mockReturnValue(false);
    mockSignInSilently.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-de-otro' }, idToken: 'idtok-x' } });
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'other_account' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
    expect(mockMarcarProveedorProbado).not.toHaveBeenCalled();
  });

  it('credencial propia SIN idToken (falta webClientId) → failed/no_token', async () => {
    mockSignInSilently.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-google-1' }, idToken: null } });
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'failed', reason: 'no_token' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
  });

  it('el directorio rechaza el token → failed/rejected', async () => {
    mockSignInSilently.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-google-1' }, idToken: 'idtok-1' } });
    mockSignIntoDirectory.mockResolvedValue({ ok: false, reason: 'rejected' });
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'failed', reason: 'rejected' });
  });

  it('signInSilently tira (sin Play Services, lo que sea) → failed/no_credential, no explota', async () => {
    mockSignInSilently.mockRejectedValue(new Error('boom'));
    expect(await reconectarGoogleSilencioso()).toEqual({ status: 'failed', reason: 'no_credential' });
  });
});

describe('fila 5 · botón «Volvé a iniciar sesión» — Google interactivo (fallback)', () => {
  it('cancelado → failed/cancelled', async () => {
    mockSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    expect(await reconectarInteractivo('google')).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
  });

  it('ok', async () => {
    mockSignIn.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-google-1' }, idToken: 'idtok-1' } });
    expect(await reconectarInteractivo('google')).toEqual({ status: 'ok' });
    expect(mockSignIntoDirectory).toHaveBeenCalledWith('google', 'idtok-1');
  });

  it('otra cuenta → other_account, nada guardado', async () => {
    mockEsYo.mockReturnValue(false);
    mockSignIn.mockResolvedValue({ type: 'success', data: { user: { id: 'sub-de-otro' }, idToken: 'idtok-x' } });
    expect(await reconectarInteractivo('google')).toEqual({ status: 'other_account' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
  });
});

describe('fila 5 · botón «Volvé a iniciar sesión» — Apple (siempre interactivo)', () => {
  it('cancelado → failed/cancelled', async () => {
    mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await reconectarInteractivo('apple')).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
  });

  it('ok, entra al directorio y registra la clave', async () => {
    mockSignInAsync.mockResolvedValue({ user: 'sub-apple-1', identityToken: 'idtok-apple' });
    expect(await reconectarInteractivo('apple')).toEqual({ status: 'ok' });
    expect(mockSignIntoDirectory).toHaveBeenCalledWith('apple', 'idtok-apple');
    expect(mockMarcarProveedorProbado).toHaveBeenCalledWith('sub-apple-1');
    expect(mockRegisterDeviceKey).toHaveBeenCalled();
  });

  it('otra cuenta → other_account, nada guardado (rechazo, fila 6)', async () => {
    mockEsYo.mockReturnValue(false);
    mockSignInAsync.mockResolvedValue({ user: 'sub-de-otro', identityToken: 'idtok-x' });
    expect(await reconectarInteractivo('apple')).toEqual({ status: 'other_account' });
    expect(mockSignIntoDirectory).not.toHaveBeenCalled();
    expect(mockMarcarProveedorProbado).not.toHaveBeenCalled();
  });

  it('un rechazo del servidor no tira: failed/rejected', async () => {
    mockSignInAsync.mockResolvedValue({ user: 'sub-apple-1', identityToken: 'idtok-apple' });
    mockSignIntoDirectory.mockResolvedValue({ ok: false, reason: 'rejected' });
    expect(await reconectarInteractivo('apple')).toEqual({ status: 'failed', reason: 'rejected' });
  });
});
