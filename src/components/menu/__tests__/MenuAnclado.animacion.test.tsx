import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { MenuAnclado } from '@/src/components/menu/MenuAnclado';
import { useSettingsStore } from '@/src/store/settingsStore';

// withTiming guarda su callback: el test decide cuándo termina la animación.
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

const ancla = { current: { measureInWindow: (cb: any) => cb(20, 100, 300, 48) } } as any;
const OPS = [{ valor: 'a', label: 'Alfa' }, { valor: 'b', label: 'Beta' }];
const menu = (visible: boolean) => (
  <MenuAnclado
    visible={visible} onClose={() => {}} ancla={ancla} opciones={OPS}
    onElegir={() => {}} accessibilityLabel="m" testID="m"
  />
);
/** Abre y deja medido el menú (frame de medición + layout de filas). */
function abierto() {
  const r = render(menu(true));
  act(() => { jest.runOnlyPendingTimers(); });
  return r;
}
const salir = () => act(() => { mockCallbacks.splice(0).forEach(cb => cb(true)); });

describe('MenuAnclado — animación y desmontaje', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCallbacks.length = 0;
    useSettingsStore.setState({ reduceAnimations: false });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('al cerrar queda montado hasta que termina la animación de salida', () => {
    const r = abierto();
    r.rerender(menu(false));
    expect(r.queryByText('Alfa')).toBeTruthy();
    salir();
    expect(r.queryByText('Alfa')).toBeNull();
  });

  it('durante la salida el menú conserva su lugar (no salta a otra posición)', () => {
    const r = abierto();
    const lugar = () => { const e = StyleSheet.flatten(r.getByTestId('m').props.style); return [e.top, e.left, e.opacity]; };
    // sin layout de filas hay que forzar el fallback de 2 frames
    act(() => { jest.runAllTimers(); });
    const antes = lugar();
    r.rerender(menu(false));
    expect(lugar()).toEqual(antes);
  });

  it('con reducir movimiento el menú no escala (sólo fundido)', () => {
    const escala = (r: ReturnType<typeof abierto>) =>
      (StyleSheet.flatten(r.getByTestId('m').props.style).transform ?? [])
        .some((t: object) => 'scale' in t);
    expect(escala(abierto())).toBe(true);
    useSettingsStore.setState({ reduceAnimations: true });
    expect(escala(abierto())).toBe(false);
  });

  it('abrir, cerrar y reabrir rápido no deja el menú desmontado', () => {
    const r = abierto();
    r.rerender(menu(false));
    r.rerender(menu(true));
    salir(); // callback de la salida vieja
    expect(r.queryByText('Alfa')).toBeTruthy();
  });

  it('desmontar con la salida en curso y terminar después no avisa nada', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = abierto();
    r.rerender(menu(false));
    r.unmount();
    salir();
    expect(error).not.toHaveBeenCalled();
  });
});
