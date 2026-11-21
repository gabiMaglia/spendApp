import React from 'react';
import { Keyboard, Modal, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { MenuAnclado } from '@/src/components/menu/MenuAnclado';
import { calcularPosicionMenu, altoVisibleMenu, BORDE_MENU } from '@/src/components/menu/calcularPosicionMenu';
import type { OpcionMenu } from '@/src/components/menu/tipos';

// Ventana e insets mutables: R1 (Android edge-to-edge) y R2 (rotación) se simulan cambiándolos.
let mockVentana = { width: 400, height: 800, scale: 1, fontScale: 1 };
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockVentana,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaProvider: ({ children }: any) => children,
}));

// Mock local (no global): withTiming corre su callback sincrónico, así la salida es testeable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

export const anclaFalsa = (r: { x: number; y: number; width: number; height: number }) =>
  ({ current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(r.x, r.y, r.width, r.height) } }) as any;

const ANCLA = anclaFalsa({ x: 20, y: 100, width: 300, height: 48 });
const OPCIONES: OpcionMenu<string>[] = [
  { valor: 'a', label: 'Alfa' },
  { valor: 'b', label: 'Beta' },
  { valor: 'c', label: 'Gamma', destructive: true },
];

function montar(extra: Partial<React.ComponentProps<typeof MenuAnclado<string>>> = {}) {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const r = render(
    <MenuAnclado
      visible onClose={onClose} ancla={ANCLA} opciones={OPCIONES} seleccionado="b"
      onElegir={onElegir} accessibilityLabel="Menú de prueba" testID="m" {...extra}
    />,
  );
  // Medido y posicionado: antes de eso el menú es invisible y no recibe toques.
  act(() => { jest.runOnlyPendingTimers(); });
  act(() => { jest.runAllTimers(); });
  return { ...r, onClose, onElegir };
}

describe('MenuAnclado — contenido, selección y cierre', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('con visible=false no monta nada (ni el Modal)', () => {
    const { UNSAFE_queryByType, queryByText } = montar({ visible: false });
    expect(UNSAFE_queryByType(Modal)).toBeNull();
    expect(queryByText('Alfa')).toBeNull();
  });

  it('renderiza una fila por opción', () => {
    const { getByText } = montar();
    ['Alfa', 'Beta', 'Gamma'].forEach(l => expect(getByText(l)).toBeTruthy());
  });

  it('sólo la opción seleccionada tiene selected=true', () => {
    const { getAllByRole } = montar();
    const items = getAllByRole('menuitem');
    expect(items.map(i => !!i.props.accessibilityState?.selected)).toEqual([false, true, false]);
  });

  it('el contenedor expone rol menu y la etiqueta', () => {
    const { getByTestId } = montar();
    const menu = getByTestId('m');
    expect(menu.props.accessibilityRole).toBe('menu');
    expect(menu.props.accessibilityLabel).toBe('Menú de prueba');
  });

  it('elegir llama onElegir(valor) una vez y onClose', () => {
    const { getByText, onElegir, onClose } = montar();
    fireEvent.press(getByText('Alfa'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tocar el velo cierra sin elegir', () => {
    const { getByTestId, onElegir, onClose } = montar();
    fireEvent.press(getByTestId('m-velo'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('el back de Android (onRequestClose) cierra', () => {
    const { UNSAFE_getByType, onClose } = montar();
    UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el Modal cubre las barras del sistema (edge-to-edge)', () => {
    const { UNSAFE_getByType } = montar();
    const props = UNSAFE_getByType(Modal).props;
    expect(props.statusBarTranslucent).toBe(true);
    expect(props.navigationBarTranslucent).toBe(true);
  });

  it('una opción con avatar muestra a la persona y se elige igual', () => {
    const { getByText, onElegir } = montar({
      opciones: [{ valor: 'u1', label: 'Ana', avatar: { userId: 'u1', name: 'Ana' } }], seleccionado: undefined,
    });
    fireEvent.press(getByText('Ana'));
    expect(onElegir).toHaveBeenCalledWith('u1');
  });
});


describe('MenuAnclado — medición, posición y regla de alto', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockVentana = { width: 400, height: 800, scale: 1, fontScale: 1 };
    mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  const ops = (n: number): OpcionMenu<number>[] =>
    Array.from({ length: n }, (_, i) => ({ valor: i, label: `Op ${i}` }));

  /** Abre, deja pasar el frame de medición y reporta el alto de cada fila. */
  function abrir(n: number, anclaRect = { x: 20, y: 100, width: 300, height: 48 }, alturas?: number[]) {
    const onClose = jest.fn();
    const ancla = anclaFalsa(anclaRect); // estable, como un ref real
    const r = render(
      <MenuAnclado
        visible onClose={onClose} ancla={ancla} opciones={ops(n)}
        onElegir={jest.fn()} accessibilityLabel="m" testID="m"
      />,
    );
    act(() => { jest.runOnlyPendingTimers(); });
    r.getAllByRole('menuitem').slice(0, 5).forEach((fila, i) =>
      fireEvent(fila, 'layout', { nativeEvent: { layout: { height: alturas?.[i] ?? 56 } } }));
    const estilo = () => StyleSheet.flatten(r.getByTestId('m').props.style);
    return { ...r, onClose, ancla, estilo };
  }

  it('al abrir descarta el teclado', () => {
    const spy = jest.spyOn(Keyboard, 'dismiss');
    abrir(3);
    expect(spy).toHaveBeenCalled();
  });

  it('ancla arriba: el menú queda debajo', () => {
    const { estilo } = abrir(3);
    expect(estilo().top).toBe(100 + 48 + 4);
  });

  it('ancla pegada al borde inferior: el menú queda arriba del ancla', () => {
    const { estilo } = abrir(3, { x: 20, y: 740, width: 300, height: 48 });
    // 3 filas + borde, sin maxHeight: termina antes del ancla
    expect(estilo().top + 3 * 56 + 2 * BORDE_MENU).toBeLessThanOrEqual(740);
  });

  it('6 opciones: 4 filas y media; 5 opciones: todas', () => {
    // border-box: el límite incluye el borde, así la media fila no queda recortada
    expect(abrir(6).estilo().maxHeight).toBe(4 * 56 + 28 + 2 * BORDE_MENU);
    // ≤5 opciones: sin maxHeight, el menú mide lo que miden sus filas (§CÓMO T3 d)
    expect(abrir(5).estilo().maxHeight).toBeUndefined();
  });

  it('las filas más altas (con sublabel) cambian el alto esperado', () => {
    const alturas = [56, 72, 56, 56, 56];
    expect(abrir(6, undefined, alturas).estilo().maxHeight).toBe(altoVisibleMenu([...alturas, 56], 6) + 2 * BORDE_MENU);
  });

  it('si cambian las dimensiones con el menú abierto, se cierra', () => {
    const { onClose, ancla, rerender } = abrir(3);
    mockVentana = { ...mockVentana, width: 800, height: 400 };
    rerender(
      <MenuAnclado
        visible onClose={onClose} ancla={ancla}
        opciones={ops(3)} onElegir={jest.fn()} accessibilityLabel="m" testID="m"
      />,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('Android edge-to-edge: usa los insets en la posición (coincide con el cálculo puro)', () => {
    mockInsets = { top: 24, bottom: 48, left: 0, right: 0 };
    const rect = { x: 20, y: 650, width: 300, height: 48 };
    const { estilo } = abrir(5, rect);
    const esperado = calcularPosicionMenu(rect, { width: 400, height: 800 }, { top: 24, bottom: 48 }, 5 * 56 + 2 * BORDE_MENU);
    expect(estilo().top).toBe(esperado.top);
    expect(estilo().maxHeight).toBeUndefined();
  });

  it('sin layout de filas tras dos frames, cae al alto mínimo y se muestra igual', () => {
    const r = render(
      <MenuAnclado
        visible onClose={jest.fn()} ancla={anclaFalsa({ x: 20, y: 100, width: 300, height: 48 })}
        opciones={ops(3)} onElegir={jest.fn()} accessibilityLabel="m" testID="m"
      />,
    );
    act(() => { jest.runOnlyPendingTimers(); }); // medir el ancla
    act(() => { jest.runAllTimers(); });         // 2 frames sin layout
    expect(StyleSheet.flatten(r.getByTestId('m').props.style).maxHeight).toBeUndefined();
  });
});


describe('MenuAnclado — no se elige dos veces ni a ciegas', () => {
  beforeEach(() => { jest.useFakeTimers(); mockVentana = { width: 400, height: 800, scale: 1, fontScale: 1 }; });
  afterEach(() => { jest.useRealTimers(); });

  const ops: OpcionMenu<string>[] = [{ valor: 'a', label: 'Alfa' }, { valor: 'b', label: 'Beta' }];
  const ancla = anclaFalsa({ x: 20, y: 100, width: 300, height: 48 });
  const el = (visible: boolean, onElegir: jest.Mock, onClose: jest.Mock) => (
    <MenuAnclado
      visible={visible} onClose={onClose} ancla={ancla} opciones={ops}
      onElegir={onElegir} accessibilityLabel="m" testID="m"
    />
  );
  /** `listo`: ya medido (posición), o sólo el frame invisible de medición. */
  function abrir(listo: boolean) {
    const onElegir = jest.fn(); const onClose = jest.fn();
    const r = render(el(true, onElegir, onClose));
    if (listo) {
      act(() => { jest.runOnlyPendingTimers(); });
      act(() => { jest.runAllTimers(); });
    }
    return { ...r, onElegir, onClose };
  }

  it('dos toques seguidos eligen una sola vez', () => {
    const { getByText, onElegir, onClose } = abrir(true);
    fireEvent.press(getByText('Alfa'));
    fireEvent.press(getByText('Beta'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el frame invisible de medición no recibe toques', () => {
    const { getByText, onElegir } = abrir(false);
    fireEvent.press(getByText('Alfa'));
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('reabrir tras elegir permite volver a elegir', () => {
    const { getByText, rerender, onElegir, onClose } = abrir(true);
    fireEvent.press(getByText('Alfa'));
    rerender(el(false, onElegir, onClose));
    rerender(el(true, onElegir, onClose));
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { jest.runAllTimers(); });
    fireEvent.press(getByText('Beta'));
    expect(onElegir).toHaveBeenCalledTimes(2);
  });
});
