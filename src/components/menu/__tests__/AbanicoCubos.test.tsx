import React from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AbanicoCubos, ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { calcularAbanico } from '@/src/components/menu/calcularAbanico';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { useSettingsStore } from '@/src/store/settingsStore';

let mockVentana = { width: 400, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockVentana,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
// withTiming corre su callback sincrónico: la salida es testeable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

const RECT = { x: 36, y: 200, width: 60, height: 60 };
const ancla = { current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(RECT.x, RECT.y, RECT.width, RECT.height) } } as any;
const sinMedida = { current: { measureInWindow: () => {} } } as any;

const OPS: OpcionCubo<string>[] = [
  { valor: 'a', icono: 'restaurant-outline', tinte: '#f80', etiqueta: 'Alfa' },
  { valor: 'b', icono: 'car-outline', tinte: '#08f', etiqueta: 'Beta' },
  { valor: 'c', icono: 'home-outline', tinte: '#0f8', etiqueta: 'Gamma' },
];

function montar(extra: Partial<React.ComponentProps<typeof AbanicoCubos<string>>> = {}) {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const props = {
    visible: true, onClose, ancla, opciones: OPS, seleccionado: 'b', onElegir,
    accessibilityLabel: 'Categoría', etiquetaCerrar: 'Cerrar', testID: 'ab', ...extra,
  } as React.ComponentProps<typeof AbanicoCubos<string>>;
  const r = render(<AbanicoCubos {...props} />);
  act(() => { jest.advanceTimersByTime(20); }); // medición (rAF)
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ...r, onClose, onElegir, props };
}

describe('AbanicoCubos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockVentana = { width: 400, height: 800, scale: 1, fontScale: 1 };
    useSettingsStore.setState({ reduceAnimations: false });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('cerrado no monta nada (ni el Modal)', () => {
    const { UNSAFE_queryByType, queryByText } = montar({ visible: false });
    expect(UNSAFE_queryByType(Modal)).toBeNull();
    expect(queryByText('Alfa')).toBeNull();
  });

  it('abierto muestra un cubo con su nombre por opción', () => {
    const { getByText, getAllByRole } = montar();
    ['Alfa', 'Beta', 'Gamma'].forEach(l => expect(getByText(l)).toBeTruthy());
    expect(getAllByRole('menuitem')).toHaveLength(3);
  });

  it('cada cubo se anuncia con su nombre y sólo el elegido está seleccionado', () => {
    const { getAllByRole } = montar();
    const items = getAllByRole('menuitem');
    expect(items.map(i => i.props.accessibilityLabel)).toEqual(['Alfa', 'Beta', 'Gamma']);
    expect(items.map(i => !!i.props.accessibilityState?.selected)).toEqual([false, true, false]);
  });

  it('el contenedor es un menu con su etiqueta', () => {
    const { getByTestId } = montar();
    expect(getByTestId('ab').props.accessibilityRole).toBe('menu');
    expect(getByTestId('ab').props.accessibilityLabel).toBe('Categoría');
  });

  it('la columna arranca a la altura del cubo original y 16 a su derecha', () => {
    const { getByTestId } = montar();
    const e = StyleSheet.flatten(getByTestId('ab').props.style);
    const esperado = calcularAbanico(RECT, mockVentana, { top: 0, bottom: 0 }, OPS.length);
    expect([e.left, e.top]).toEqual([RECT.x + RECT.width + 16, RECT.y]);
    expect([e.left, e.top]).toEqual([esperado.left, esperado.top]);
  });

  it('elegir llama onElegir con el valor y cierra', () => {
    const { getByText, onElegir, onClose } = montar();
    fireEvent.press(getByText('Gamma'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('c');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('doble toque: sólo se elige el primero', () => {
    const { getByText, onElegir } = montar();
    fireEvent.press(getByText('Alfa'));
    fireEvent.press(getByText('Gamma'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('a');
  });

  it('antes de medir el ancla no recibe elecciones', () => {
    const r = montar({ ancla: sinMedida });
    expect(r.queryByText('Alfa')).toBeNull(); // sin posición no hay cubos que tocar
    expect(r.onElegir).not.toHaveBeenCalled();
  });

  it('tocar el velo cierra sin elegir', () => {
    const { getByTestId, onClose, onElegir } = montar();
    fireEvent.press(getByTestId('ab-velo'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('back de Android y escape de VoiceOver cierran', () => {
    const { UNSAFE_getByType, getByTestId, onClose } = montar();
    act(() => { UNSAFE_getByType(Modal).props.onRequestClose(); });
    act(() => { getByTestId('ab').props.onAccessibilityEscape(); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('al cerrar se desmonta cuando termina la salida', () => {
    const { rerender, props, queryByText } = montar();
    rerender(<AbanicoCubos {...props} visible={false} />);
    act(() => { jest.runAllTimers(); });
    expect(queryByText('Alfa')).toBeNull();
  });

  it('cerrado antes de mostrarse se desmonta sin esperar ninguna animación', () => {
    const { rerender, props, UNSAFE_queryByType } = montar({ ancla: sinMedida });
    rerender(<AbanicoCubos {...props} visible={false} />);
    expect(UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('(control) montado sin medir sí hay Modal hasta que se cierra', () => {
    const r = render(<AbanicoCubos {...montar({ ancla: sinMedida }).props} />);
    expect(r.UNSAFE_queryByType(Modal)).toBeTruthy();
  });

  it('cabe: la columna no scrollea', () => {
    const { UNSAFE_getByType } = montar();
    expect(UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(false);
  });

  it('no cabe hacia abajo: la columna scrollea (sin recuadro)', () => {
    mockVentana = { width: 400, height: 330, scale: 1, fontScale: 1 };
    const { UNSAFE_getByType } = montar();
    expect(UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(true);
  });

  it('con reducir movimiento los cubos aparecen sin desplazamiento', () => {
    const normal = montar();
    const hay = (r: ReturnType<typeof montar>) => JSON.stringify(r.toJSON()).includes('translateY');
    expect(hay(normal)).toBe(true);
    normal.unmount();
    useSettingsStore.setState({ reduceAnimations: true });
    const reducido = montar();
    expect(reducido.getAllByRole('menuitem')).toHaveLength(3);
    expect(hay(reducido)).toBe(false);
  });

  it('D1: un toque sobre el ancla durante la apertura no elige nada', () => {
    const onElegir = jest.fn();
    const r = render(
      <AbanicoCubos
        visible onClose={jest.fn()} ancla={ancla} opciones={OPS} onElegir={onElegir}
        accessibilityLabel="c" etiquetaCerrar="x" testID="ab"
      />,
    );
    act(() => { jest.advanceTimersByTime(20); }); // medido
    act(() => { jest.advanceTimersByTime(ASENTAR_MS - 50); }); // pero sin asentar
    fireEvent.press(r.getByText('Alfa'));
    expect(onElegir).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.press(r.getByText('Alfa'));
    expect(onElegir).toHaveBeenCalledWith('a');
  });

  it('D2: el área de toque de cada cubo viaja con él (el translate envuelve la fila)', () => {
    const { getAllByRole } = montar();
    let nodo = getAllByRole('menuitem')[1].parent as any;
    let con = false;
    for (let i = 0; i < 3 && nodo && !con; i++, nodo = nodo.parent) {
      con = JSON.stringify(StyleSheet.flatten(nodo.props.style) ?? {}).includes('translateY');
    }
    expect(con).toBe(true);
  });
});
