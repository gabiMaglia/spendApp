import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useRespaldo } from '../useRespaldo';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { BackupFile } from '@/src/services/backup';
import type { User } from '@/src/types/models';

let mockArchivo = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///x.hushsplit' }] })),
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ text: async () => mockArchivo })),
}));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(),
  anunciarMiTarjeta: jest.fn(),
}));
const mockAdoptar = jest.fn();
jest.mock('@/src/services/adoptarRespaldoDeInvitado', () => ({
  ...jest.requireActual('@/src/services/adoptarRespaldoDeInvitado'),
  adoptarRespaldoDeInvitado: (...a: unknown[]) => mockAdoptar(...a),
}));

const DUENO: User = {
  id: 'invitado-viejo', updatedAt: 1, isDeleted: false, name: 'Gabi', email: '',
  authProvider: 'guest', createdAt: 0,
};
const SESION: User = { ...DUENO, id: 'invitado-nuevo', name: 'Invitado' };

function respaldo(users: User[]): BackupFile {
  return {
    format: 'splitp2p-backup', version: 3, exportedAt: 1, groups: [], expenses: [], payments: [],
    users, personalEntries: [],
    personalBudget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false },
    ownerId: DUENO.id,
  };
}

/** Botones del último Alert.alert. */
function botones() {
  const llamada = (Alert.alert as jest.Mock).mock.calls.at(-1);
  return { titulo: llamada[0] as string, botones: llamada[2] as { text: string; onPress?: () => void }[] };
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockAdoptar.mockReset();
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
});

describe('useRespaldo.handleImport · invitado (T-249)', () => {
  it('invitado vacío + respaldo de invitado: ofrece «Seguir como…» y al aceptar adopta la identidad', async () => {
    useAuthStore.setState({ currentUser: SESION });
    mockArchivo = JSON.stringify(respaldo([DUENO]));
    const { result } = renderHook(() => useRespaldo());

    await act(async () => { await result.current.handleImport(); });

    const { titulo, botones: b } = botones();
    expect(titulo).toBe('backup.guest_title');
    expect(mockAdoptar).not.toHaveBeenCalled();
    act(() => b[1].onPress!());
    expect(mockAdoptar).toHaveBeenCalledWith(expect.objectContaining({ ownerId: DUENO.id }), DUENO);
  });

  it('cancelar no adopta ni importa nada', async () => {
    useAuthStore.setState({ currentUser: SESION });
    mockArchivo = JSON.stringify(respaldo([DUENO]));
    const { result } = renderHook(() => useRespaldo());

    await act(async () => { await result.current.handleImport(); });

    // El primer botón es «cancelar» y no tiene acción.
    expect(botones().botones[0].onPress).toBeUndefined();
    expect(mockAdoptar).not.toHaveBeenCalled();
  });

  it('sesión de Google: sigue el camino de siempre (respaldo ajeno)', async () => {
    useAuthStore.setState({ currentUser: { ...SESION, authProvider: 'google' } });
    mockArchivo = JSON.stringify(respaldo([DUENO]));
    const { result } = renderHook(() => useRespaldo());

    await act(async () => { await result.current.handleImport(); });

    expect(botones().titulo).toBe('backup.foreign_title');
  });

  it('invitado que ya tiene grupos: sigue el camino de siempre (respaldo ajeno)', async () => {
    useAuthStore.setState({ currentUser: SESION });
    useGroupStore.setState({ groups: [{
      id: 'g', updatedAt: 1, isDeleted: false, name: 'g', memberIds: [], miembros: {},
      currency: 'ARS', createdAt: 0, createdById: 'x',
    }] });
    mockArchivo = JSON.stringify(respaldo([DUENO]));
    const { result } = renderHook(() => useRespaldo());

    await act(async () => { await result.current.handleImport(); });

    expect(botones().titulo).toBe('backup.foreign_title');
  });
});
