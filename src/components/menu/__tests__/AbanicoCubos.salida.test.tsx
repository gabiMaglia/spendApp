import React from 'react';
import { ScrollView } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';
import { FUNDIDO_MS } from '@/src/components/menu/useAnimacionMenu';
import { useSettingsStore } from '@/src/store/settingsStore';

// withTiming guarda su callback: el test decide cuándo termina la salida.
const mockCallbacks: ((fin: boolean) => void)[] = [];
const mockDuraciones: number[] = [];
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require('react-native-reanimated/mock');
  return {
    ...base,
    // estable entre renders (el del mock crea uno nuevo cada vez)
    useSharedValue: (v: number) => require('react').useRef({ value: v }).current,
    withTiming: (to: number, c: { duration: number }, cb?: (fin: boolean) => void) => {
      if (to === 0) mockDuraciones.push(c.duration);
      if (cb) mockCallbacks.push(cb);
      return to;
    },
  };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const ancla = { current: { measureInWindow: (cb: any) => cb(36, 200, 60, 60) } } as any;
const OPS = [
  { valor: 'a', icono: 'car-outline' as const, tinte: '#08f', etiqueta: 'Alfa' },
  { valor: 'b', icono: 'home-outline' as const, tinte: '#0f8', etiqueta: 'Beta' },
];
const onElegir = jest.fn();
const abanico = (visible: boolean) => (
  <AbanicoCubos
    visible={visible} onClose={() => {}} ancla={ancla} opciones={OPS} onElegir={onElegir}
    accessibilityLabel="c" etiquetaCerrar="x" testID="ab"
  />
);

describe('AbanicoCubos — salida', () => {
  beforeEach(() => { jest.useFakeTimers(); mockCallbacks.length = 0; mockDuraciones.length = 0; onElegir.mockClear(); useSettingsStore.setState({ reduceAnimations: false }); });
  afterEach(() => { jest.useRealTimers(); });

  function abierto() {
    const r = render(abanico(true));
    act(() => { jest.advanceTimersByTime(20); });
    act(() => { jest.advanceTimersByTime(400); });
    return r;
  }

  it('al cerrar queda montado hasta que termina la salida, y ahí se desmonta', () => {
    const r = abierto();
    r.rerender(abanico(false));
    expect(r.queryByText('Alfa')).toBeTruthy();
    act(() => { mockCallbacks.splice(0).forEach(cb => cb(true)); });
    expect(r.queryByText('Alfa')).toBeNull();
  });

  it('durante la salida un toque no elige nada', () => {
    const r = abierto();
    r.rerender(abanico(false));
    fireEvent.press(r.getByText('Alfa'));
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('con reducir movimiento los cubos no se fundido más que lo que tarda en desmontarse el Modal', () => {
    useSettingsStore.setState({ reduceAnimations: true });
    const r = abierto();
    r.rerender(abanico(false));
    expect(mockDuraciones.length).toBeGreaterThan(0);
    expect(Math.max(...mockDuraciones)).toBeLessThanOrEqual(FUNDIDO_MS);
  });

  it('con la columna scrolleada, al recogerse los cubos vuelven al original visible', () => {
    const r = abierto();
    act(() => { r.UNSAFE_getByType(ScrollView).props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } }); });
    r.rerender(abanico(false));
    r.rerender(abanico(false)); // el estilo se calcula en el render que sigue a la salida
    const json = JSON.stringify(r.toJSON());
    // cubo 1: -(1*PASO) + 100 = 28
    expect(json).toContain('"translateY":100'); // cubo 0 va al original visible
    expect(json).toContain('"translateY":28');
  });
});
