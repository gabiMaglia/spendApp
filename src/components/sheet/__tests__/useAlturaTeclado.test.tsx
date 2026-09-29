import { renderHook } from '@testing-library/react-native';
import { Animated, Keyboard, Platform } from 'react-native';
import { useAlturaTeclado } from '@/src/components/sheet/useAlturaTeclado';

/**
 * PO 2026-09-29 (Moto E40, Android 11): el teclado tapaba los botones de las
 * hojas de Editar perfil y Presupuesto. Causa: React Native en Android informa
 * el alto del teclado SIN la barra de navegación
 * (`ReactRootView.java`: `imeInsets.bottom - barInsets.bottom`), pero la hoja
 * se dibuja DEBAJO de esa barra (`navigationBarTranslucent`): subía la hoja
 * justo el alto de la barra de menos. En Android se suma la barra.
 */
function capturarListeners() {
  const cbs: Record<string, (e: unknown) => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((ev: string, cb: (e: unknown) => void) => {
    cbs[ev] = cb;
    return { remove: jest.fn() };
  }) as never);
  return cbs;
}

function destinoDeLaAnimacion() {
  const timing = jest.spyOn(Animated, 'timing');
  return () => (timing.mock.calls.at(-1)?.[1] as { toValue: number }).toValue;
}

const plataformaOriginal = Platform.OS;
afterEach(() => { jest.restoreAllMocks(); Object.defineProperty(Platform, 'OS', { value: plataformaOriginal }); });

describe('useAlturaTeclado', () => {
  it('Android: el teclado sube la hoja su alto MÁS la barra de navegación', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    const cbs = capturarListeners();
    const destino = destinoDeLaAnimacion();
    renderHook(() => useAlturaTeclado(48));
    cbs.keyboardDidShow({ endCoordinates: { height: 300 } });
    expect(destino()).toBe(348);
  });

  it('Android: al cerrarse vuelve a 0', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    const cbs = capturarListeners();
    const destino = destinoDeLaAnimacion();
    renderHook(() => useAlturaTeclado(48));
    cbs.keyboardDidHide({});
    expect(destino()).toBe(0);
  });

  it('iOS: el alto ya incluye la zona inferior, no se suma nada', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    const cbs = capturarListeners();
    const destino = destinoDeLaAnimacion();
    renderHook(() => useAlturaTeclado(34));
    cbs.keyboardWillShow({ endCoordinates: { height: 300 }, duration: 250 });
    expect(destino()).toBe(300);
  });
});
