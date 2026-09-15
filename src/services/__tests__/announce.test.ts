import { announce, announceKeyConflict } from '../notifications';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { KeyConflictNotice, Notice } from '../syncNotices';
import type { User } from '@/src/types/models';

const mockSchedule = jest.fn(async () => 'id');
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: () => mockSchedule(),
}));

const gasto: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Asado', count: 1 };

beforeEach(() => {
  mockSchedule.mockClear();
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useNoticeInboxStore.getState().clear();
  useSettingsStore.setState({ notifExpenses: true, notifDeletions: true, notifInvites: true });
});

describe('announce', () => {
  it('registra en la bandeja y ademas avisa al sistema', async () => {
    await announce([gasto]);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('con el toggle APAGADO no avisa al sistema, pero SI queda en la bandeja', async () => {
    // Decision del PO (D4): el toggle gobierna el aviso, no el registro.
    // Perder el registro en silencio es peor que no vibrar.
    useSettingsStore.setState({ notifExpenses: false });
    await announce([gasto]);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(useNoticeInboxStore.getState().unreadCount()).toBe(1);
  });

  it('sin avisos no hace nada', async () => {
    await announce([]);
    expect(useNoticeInboxStore.getState().items).toHaveLength(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('si la bandeja falla, el aviso del sistema sale igual', async () => {
    // Misma premisa que el resto del modulo: nada de esto puede tumbar el sync.
    const spy = jest.spyOn(useNoticeInboxStore.getState(), 'record').mockImplementation(() => {
      throw new Error('storage lleno');
    });
    await expect(announce([gasto])).resolves.not.toThrow();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    // Sin restaurar, el mock sobrevive a este test y rompe `record()` para
    // cualquier test de este archivo que corra después (orden de ejecución).
    spy.mockRestore();
  });
});

describe('announceKeyConflict (T-136): como máximo un aviso sin leer por grupo', () => {
  const conflicto: KeyConflictNotice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje',
    senderIds: ['u-beto', 'u-mallory'],
  };

  it('el primero se registra y avisa', async () => {
    expect(await announceKeyConflict(conflicto)).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('otro conflicto del MISMO grupo con uno sin leer no apila', async () => {
    await announceKeyConflict(conflicto);
    expect(await announceKeyConflict({ ...conflicto, senderIds: ['u-beto', 'u-mallory', 'u-carla'] })).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('otro grupo sí avisa', async () => {
    await announceKeyConflict(conflicto);
    await announceKeyConflict({ ...conflicto, groupId: 'g2' });
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });

  it('con el anterior ya leído, un conflicto nuevo vuelve a avisar', async () => {
    await announceKeyConflict(conflicto);
    useNoticeInboxStore.getState().markAllRead();
    await announceKeyConflict(conflicto);
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });
});
