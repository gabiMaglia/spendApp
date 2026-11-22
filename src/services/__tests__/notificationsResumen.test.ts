import { deliver, announce, resetPermissionCache, onNotificationTap } from '@/src/services/notifications';
import i18n from '@/src/i18n';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import type { Notice } from '@/src/services/syncNotices';

type Programada = { content: { title: string; body: string; data?: Record<string, unknown> }; trigger: null };
const mockSchedule = jest.fn(async (_a: Programada) => 'id');
let listener: ((r: unknown) => void) | null = null;
const mockRemove = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: (a: unknown) => mockSchedule(a as Programada),
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
    listener = fn;
    return { remove: mockRemove };
  },
}));

const unido = (id: string, name: string): Notice => ({ kind: 'joined', groupId: id, groupName: name });
const reloj: Notice = { kind: 'clock_off', offsetMs: 5000 };

beforeEach(async () => {
  await i18n.changeLanguage('es');
  mockSchedule.mockClear();
  mockRemove.mockClear();
  listener = null;
  resetPermissionCache();
  useSettingsStore.setState({ notifExpenses: true, notifDeletions: true, notifInvites: true });
  useNoticeInboxStore.setState({ items: [] } as never);
});

describe('resumen de ráfaga (T-295)', () => {
  it('1 y 2 avisos salen uno por uno, como siempre', async () => {
    await deliver([unido('a', 'A')]);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    mockSchedule.mockClear();
    await deliver([unido('a', 'A'), unido('b', 'B')]);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('3 o más: una sola notificación resumen', async () => {
    const n = await deliver([unido('a', 'A'), unido('b', 'B'), unido('c', 'C'), unido('a', 'A')]);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(n).toBe(1);
    const { content } = mockSchedule.mock.calls[0][0];
    expect(content.title).toBe('Novedades en HushSplit');
    expect(content.body).toBe('Tenés 4 novedades en 3 grupos');
  });

  it('un solo grupo usa la variante con nombre; sin grupo, la simple', async () => {
    await deliver([unido('a', 'A'), unido('a', 'A'), unido('a', 'A')]);
    expect(mockSchedule.mock.calls[0][0].content.body).toBe('Tenés 3 novedades en «A»');
    mockSchedule.mockClear();
    await deliver([reloj, reloj, reloj]);
    expect(mockSchedule.mock.calls[0][0].content.body).toBe('Tenés 3 novedades');
  });

  it('cuenta sólo los avisos que el usuario quiere (toggles respetados)', async () => {
    useSettingsStore.setState({ notifInvites: false });
    // 3 joined apagados + 2 reloj => quedan 2 => sin resumen
    await deliver([unido('a', 'A'), unido('b', 'B'), unido('c', 'C'), reloj, reloj]);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('el resumen apunta al destino general (Actividad)', async () => {
    await deliver([reloj, reloj, reloj]);
    expect(mockSchedule.mock.calls[0][0].content.data).toEqual({ destino: '/(tabs)/activity' });
  });

  it('la bandeja recibe todos los avisos individuales', async () => {
    const avisos = [unido('a', 'A'), unido('b', 'B'), unido('c', 'C')];
    await announce(avisos);
    expect(useNoticeInboxStore.getState().items).toHaveLength(3);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });
});

describe('tap en la notificación', () => {
  it('navega al destino que trae el resumen', () => {
    const ir = jest.fn();
    onNotificationTap(ir);
    listener!({ notification: { request: { content: { data: { destino: '/(tabs)/activity' } } } } });
    expect(ir).toHaveBeenCalledWith('/(tabs)/activity');
  });

  it('un aviso individual (sin destino) no navega', () => {
    const ir = jest.fn();
    onNotificationTap(ir);
    listener!({ notification: { request: { content: { data: {} } } } });
    expect(ir).not.toHaveBeenCalled();
  });

  it('devuelve cómo desuscribirse', () => {
    const off = onNotificationTap(jest.fn());
    off();
    expect(mockRemove).toHaveBeenCalled();
  });
});
