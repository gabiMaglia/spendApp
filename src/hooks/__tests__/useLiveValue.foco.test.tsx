import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { useLiveValue } from '@/src/hooks/useLiveValue';

/**
 * T-222 (medido en T-216, Moto E40): las pestañas quedan montadas y
 * congeladas (`Freeze`) al salir de ellas, y el sondeo de `useLiveValue`
 * seguía corriendo cada 2 s en Cuenta aunque no se viera — un frame de 35 ms
 * cada 2 s en reposo. Con navegador, el sondeo se pausa al perder el foco y se
 * retoma (con lectura inmediata) al recuperarlo. Sin navegador (tests,
 * componentes sueltos), se comporta como siempre.
 */

type Evento = 'focus' | 'blur';

function navegacionFalsa(enfocada: boolean) {
  const oyentes: Record<Evento, Set<() => void>> = { focus: new Set(), blur: new Set() };
  const nav = {
    enfocada,
    isFocused: () => nav.enfocada,
    addListener: (ev: Evento, cb: () => void) => {
      oyentes[ev].add(cb);
      return () => { oyentes[ev].delete(cb); };
    },
    emitir(ev: Evento) {
      nav.enfocada = ev === 'focus';
      oyentes[ev].forEach(cb => cb());
    },
  };
  return nav;
}

function conNavegacion(nav: ReturnType<typeof navegacionFalsa>) {
  return function Envoltorio({ children }: { children: React.ReactNode }) {
    return <NavigationContext.Provider value={nav as never}>{children}</NavigationContext.Provider>;
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useLiveValue — pausa fuera de foco (T-222)', () => {
  it('con la pantalla enfocada sondea como siempre', () => {
    let v = 0;
    const nav = navegacionFalsa(true);
    const { result } = renderHook(() => useLiveValue(() => v, 1000), { wrapper: conNavegacion(nav) });
    v = 3;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(3);
  });

  it('al perder el foco deja de leer', () => {
    const read = jest.fn(() => 1);
    const nav = navegacionFalsa(true);
    renderHook(() => useLiveValue(read, 1000), { wrapper: conNavegacion(nav) });
    act(() => { nav.emitir('blur'); });
    const llamadas = read.mock.calls.length;
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(read.mock.calls.length).toBe(llamadas);
  });

  it('montada sin foco no sondea', () => {
    const read = jest.fn(() => 1);
    const nav = navegacionFalsa(false);
    renderHook(() => useLiveValue(read, 1000), { wrapper: conNavegacion(nav) });
    const llamadas = read.mock.calls.length;
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(read.mock.calls.length).toBe(llamadas);
  });

  it('al recuperar el foco lee en el acto y retoma el intervalo', () => {
    let v = 0;
    const nav = navegacionFalsa(true);
    const { result } = renderHook(() => useLiveValue(() => v, 1000), { wrapper: conNavegacion(nav) });
    act(() => { nav.emitir('blur'); });
    v = 7;
    act(() => { nav.emitir('focus'); });
    expect(result.current).toBe(7); // sin esperar un intervalo
    v = 9;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(9);
  });

  it('al desmontar suelta los oyentes de foco', () => {
    const read = jest.fn(() => 1);
    const nav = navegacionFalsa(true);
    const { unmount } = renderHook(() => useLiveValue(read, 1000), { wrapper: conNavegacion(nav) });
    unmount();
    const llamadas = read.mock.calls.length;
    act(() => { nav.emitir('focus'); jest.advanceTimersByTime(5000); });
    expect(read.mock.calls.length).toBe(llamadas);
  });
});
