import { Platform } from 'react-native';
import { syncAndroidNavigationBar } from '../androidNavigationBar';

/**
 * T-137: la barra de tres botones de Android no heredaba el tema de la app
 * (quedaba clara siempre, sin importar modo claro/oscuro). Éste es el único
 * módulo que puede importar `expo-navigation-bar` — se mockea acá para que
 * ningún otro test dependa de un módulo nativo que no existe en Jest.
 */
const mockSetBackgroundColorAsync = jest.fn((_color: string) => Promise.resolve());
const mockSetButtonStyleAsync = jest.fn((_style: string) => Promise.resolve());
jest.mock('expo-navigation-bar', () => ({
  setBackgroundColorAsync: (color: string) => mockSetBackgroundColorAsync(color),
  setButtonStyleAsync: (style: string) => mockSetButtonStyleAsync(style),
}));

const mockModuloNativo = jest.fn((_name: string): object | null => ({}));
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => mockModuloNativo(name),
}));

const platformOriginal = Platform.OS;
function setPlatformOS(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}
afterEach(() => {
  jest.clearAllMocks();
  mockModuloNativo.mockImplementation(() => ({}));
  setPlatformOS(platformOriginal);
});

describe('syncAndroidNavigationBar', () => {
  it('en iOS no hace nada — el método ni existe ahí', async () => {
    setPlatformOS('ios');

    await syncAndroidNavigationBar('#FBFAF8', 'light');

    expect(mockSetBackgroundColorAsync).not.toHaveBeenCalled();
    expect(mockSetButtonStyleAsync).not.toHaveBeenCalled();
  });

  it('en Android claro, pinta el fondo y pide íconos oscuros', async () => {
    setPlatformOS('android');

    await syncAndroidNavigationBar('#FBFAF8', 'light');

    expect(mockSetBackgroundColorAsync).toHaveBeenCalledWith('#FBFAF8');
    expect(mockSetButtonStyleAsync).toHaveBeenCalledWith('dark');
  });

  it('en Android oscuro, pide íconos claros', async () => {
    setPlatformOS('android');

    await syncAndroidNavigationBar('#0F1112', 'dark');

    expect(mockSetBackgroundColorAsync).toHaveBeenCalledWith('#0F1112');
    expect(mockSetButtonStyleAsync).toHaveBeenCalledWith('light');
  });

  it('si el sistema rechaza el pedido (best effort), no lanza', async () => {
    setPlatformOS('android');
    mockSetBackgroundColorAsync.mockImplementationOnce(() => Promise.reject(new Error('no')));

    await expect(syncAndroidNavigationBar('#FBFAF8', 'light')).resolves.toBeUndefined();
  });

  it('sin el módulo nativo en el binario (dev client viejo), no intenta importarlo ni hace nada', async () => {
    setPlatformOS('android');
    mockModuloNativo.mockImplementation(() => null);

    await syncAndroidNavigationBar('#FBFAF8', 'light');

    expect(mockSetBackgroundColorAsync).not.toHaveBeenCalled();
    expect(mockSetButtonStyleAsync).not.toHaveBeenCalled();
  });
});
