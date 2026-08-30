import { announce } from '../notifications';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Notice } from '../syncNotices';
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
    jest.spyOn(useNoticeInboxStore.getState(), 'record').mockImplementation(() => {
      throw new Error('storage lleno');
    });
    await expect(announce([gasto])).resolves.not.toThrow();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });
});
