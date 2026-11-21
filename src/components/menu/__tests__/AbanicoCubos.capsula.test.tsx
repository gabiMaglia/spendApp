import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { AbanicoCubos, ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { ALTO_FILA, GAP_CUBOS } from '@/src/components/menu/calcularAbanico';
import { useSettingsStore } from '@/src/store/settingsStore';

// La entrada nunca termina: el estilo inicial de cada cápsula queda a la vista.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require('react-native-reanimated/mock');
  return {
    ...base,
    useSharedValue: (v: number) => require('react').useRef({ value: v }).current,
    withSpring: () => 0,
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
const ops = (n: number) => Array.from({ length: n }, (_, i) => ({
  valor: `v${i}`, icono: 'car-outline' as const, tinte: '#08f', etiqueta: `Op${i}`,
}));

function montar(n: number, seleccionado?: string) {
  const r = render(
    <AbanicoCubos
      visible onClose={() => {}} ancla={ancla} opciones={ops(n)} seleccionado={seleccionado}
      onElegir={() => {}} accessibilityLabel="c" etiquetaCerrar="x" testID="ab"
    />,
  );
  act(() => { jest.advanceTimersByTime(20 + ASENTAR_MS + 50); });
  return r;
}

describe('AbanicoCubos — cápsulas (T-285)', () => {
  beforeEach(() => { jest.useFakeTimers(); useSettingsStore.setState({ reduceAnimations: false }); });
  afterEach(() => { jest.useRealTimers(); });

  it('la columna queda a la derecha del cubo original, a su misma altura', () => {
    const e = StyleSheet.flatten(montar(3).getByTestId('ab').props.style);
    expect([e.left, e.top]).toEqual([36 + 60 + 16, 200]);
  });

  it('con 9 opciones se ven 4 filas: el alto visible de la columna es el de 4', () => {
    const r = montar(9);
    const sv = r.UNSAFE_getByType(ScrollView);
    expect(StyleSheet.flatten(sv.props.style).maxHeight).toBe(4 * ALTO_FILA + 3 * GAP_CUBOS);
    expect(sv.props.scrollEnabled).toBe(true);
    expect(r.getAllByRole('menuitem')).toHaveLength(9);
  });

  it('el ✓ sólo está en la fila elegida', () => {
    const r = montar(3, 'v1');
    expect(r.getAllByTestId('ab-check')).toHaveLength(1);
    expect(r.getAllByRole('menuitem')[1].findAllByProps({ testID: 'ab-check' }).length).toBeGreaterThan(0);
  });

  it('sin elegida no hay ✓', () => {
    expect(montar(3).queryByTestId('ab-check')).toBeNull();
  });

  it('el fundido del borde inferior sólo existe si hay scroll', () => {
    expect(montar(9).queryByTestId('ab-fundido')).toBeTruthy();
    expect(montar(3).queryByTestId('ab-fundido')).toBeNull();
  });

  it('cada cápsula nace sobre el cubo original: parte desplazada en X hacia el ancla', () => {
    const json = JSON.stringify(montar(2).toJSON());
    expect(json).toContain('"translateX":-76');
  });
});
