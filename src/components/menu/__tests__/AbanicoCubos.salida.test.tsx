import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';

// withTiming guarda su callback: el test decide cuándo termina la salida.
const mockCallbacks: ((fin: boolean) => void)[] = [];
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require('react-native-reanimated/mock');
  return {
    ...base,
    withTiming: (to: number, _c: unknown, cb?: (fin: boolean) => void) => {
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
  beforeEach(() => { jest.useFakeTimers(); mockCallbacks.length = 0; onElegir.mockClear(); });
  afterEach(() => { jest.useRealTimers(); });

  function abierto() {
    const r = render(abanico(true));
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { jest.runAllTimers(); });
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
});
