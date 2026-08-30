import { installNotificationHandler, resetNotificationHandler } from '../notifications';

const mockSetHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (h: unknown) => mockSetHandler(h),
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

beforeEach(() => {
  mockSetHandler.mockClear();
  resetNotificationHandler();
});

describe('presentación con la app en primer plano', () => {
  // Sin handler registrado, expo-notifications NO muestra nada mientras la app
  // corre: "the default behavior when the handler is not set (...) is not to
  // show the notification" — docs de Expo SDK 54. El aviso se generaba bien y
  // se descartaba sin pintarse; era invisible para los tests que sólo miraban
  // scheduleNotificationAsync.
  it('registra un handler de presentación', () => {
    installNotificationHandler();
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
  });

  it('el aviso se muestra en primer plano (banner + lista)', async () => {
    installNotificationHandler();
    const config = mockSetHandler.mock.calls[0][0] as {
      handleNotification: () => Promise<Record<string, boolean>>;
    };
    const r = await config.handleNotification();
    // SDK 54: shouldShowAlert está deprecado; lo reemplazan estos dos.
    expect(r.shouldShowBanner).toBe(true);
    expect(r.shouldShowList).toBe(true);
  });

  it('es idempotente: llamarlo dos veces no registra dos handlers', () => {
    installNotificationHandler();
    installNotificationHandler();
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
  });
});
