import React from 'react';
import { act, render } from '@testing-library/react-native';

import { AbanicoCubos, ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { hapticAbrir } from '@/src/utils/haptics';

jest.mock('@/src/utils/haptics', () => ({ hapticAbrir: jest.fn() }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const ancla = { current: { measureInWindow: (cb: any) => cb(36, 200, 60, 60) } } as any;
const opciones = [{ valor: 'a', icono: 'car-outline' as const, tinte: '#08f', etiqueta: 'A' }];

const abanico = (visible: boolean) => (
  <AbanicoCubos
    visible={visible} onClose={() => {}} ancla={ancla} opciones={opciones}
    onElegir={() => {}} accessibilityLabel="c" etiquetaCerrar="x"
  />
);

describe('AbanicoCubos — vibración «abrir» (T-289)', () => {
  beforeEach(() => { jest.useFakeTimers(); (hapticAbrir as jest.Mock).mockClear(); });
  afterEach(() => { jest.useRealTimers(); });

  it('vibra «abrir» una vez al abrirse, y de nuevo en cada reapertura', () => {
    const r = render(abanico(false));
    expect(hapticAbrir).not.toHaveBeenCalled();
    r.rerender(abanico(true));
    act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
    expect(hapticAbrir).toHaveBeenCalledTimes(1);
    r.rerender(abanico(false));
    act(() => { jest.advanceTimersByTime(500); });
    r.rerender(abanico(true));
    act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
    expect(hapticAbrir).toHaveBeenCalledTimes(2);
  });
});
