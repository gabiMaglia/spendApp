import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AbanicoCubos, ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { calcularFila } from '@/src/components/menu/calcularFila';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { useSettingsStore } from '@/src/store/settingsStore';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

const rectDe = (x: number, y: number, w = 100, h = 44) => ({
  current: { measureInWindow: (cb: any) => cb(x, y, w, h) },
}) as any;
const IZQ = rectDe(40, 300);
const DER = rectDe(260, 300);

const ops = (n: number): OpcionCubo<string>[] => Array.from({ length: n }, (_, i) => ({
  valor: `v${i}`, icono: 'car-outline' as const, tinte: '#08f', etiqueta: `Op${i}`,
}));

function montar(n: number, extra: Partial<React.ComponentProps<typeof AbanicoCubos<string>>> = {}) {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const r = render(
    <AbanicoCubos
      visible onClose={onClose} ancla={IZQ} opciones={ops(n)} onElegir={onElegir}
      accessibilityLabel="Fecha" etiquetaCerrar="Cerrar" testID="ab" orientacion="fila" {...extra}
    />,
  );
  act(() => { jest.advanceTimersByTime(20); }); // medición (rAF)
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ...r, onClose, onElegir };
}

describe('AbanicoCubos orientación fila (T-282 t2)', () => {
  beforeEach(() => { jest.useFakeTimers(); useSettingsStore.setState({ reduceAnimations: false }); });
  afterEach(() => { jest.useRealTimers(); });

  it('el contenedor cae donde dice calcularFila (derecha y abajo para un ancla a la izquierda)', () => {
    const e = StyleSheet.flatten(montar(3).getByTestId('ab').props.style);
    const g = calcularFila({ x: 40, y: 300, width: 100, height: 44 }, { width: 400, height: 800 }, { top: 0, bottom: 0 }, 3);
    expect([e.left, e.top]).toEqual([g.left, g.top]);
    expect(g.haciaDerecha).toBe(true);
  });

  it('un cubo con su nombre por opción, con rol menu y la actual seleccionada', () => {
    const r = montar(3, { seleccionado: 'v1' });
    expect(r.getByTestId('ab').props.accessibilityRole).toBe('menu');
    const items = r.getAllByRole('menuitem');
    expect(items.map(i => i.props.accessibilityLabel)).toEqual(['Op0', 'Op1', 'Op2']);
    expect(items.map(i => !!i.props.accessibilityState?.selected)).toEqual([false, true, false]);
    expect(r.getAllByTestId('ab-check')).toHaveLength(1);
  });

  it('con 7 opciones: scroll horizontal, indicador y destello al asentar, fundido en el borde', () => {
    const r = montar(7);
    const sv = r.UNSAFE_getByType(ScrollView);
    expect(sv.props.horizontal).toBe(true);
    expect(sv.props.scrollEnabled).toBe(true);
    expect(sv.props.showsHorizontalScrollIndicator).toBe(true);
    expect(sv.instance.flashScrollIndicators).toHaveBeenCalled();
    expect(r.getAllByRole('menuitem')).toHaveLength(7);
    expect(r.queryByTestId('ab-fundido')).toBeTruthy();
    expect(StyleSheet.flatten(r.getByTestId('ab-ventana').props.style).overflow).toBe('hidden');
  });

  it('con 4 o menos no hay scroll ni fundido', () => {
    const r = montar(4);
    expect(r.UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(false);
    expect(r.queryByTestId('ab-fundido')).toBeNull();
  });

  it('hacia la izquierda la primera opción queda junto al ancla (la más a la derecha)', () => {
    const r = montar(7, { ancla: DER });
    const items = r.getAllByRole('menuitem');
    expect(items[items.length - 1].props.accessibilityLabel).toBe('Op0');
    expect(items[0].props.accessibilityLabel).toBe('Op6');
  });

  it('elegir llama onElegir una vez con el valor y cierra; el doble toque no repite', () => {
    const { getByText, onElegir, onClose } = montar(3);
    fireEvent.press(getByText('Op2'));
    fireEvent.press(getByText('Op1'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('v2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tocar el velo cierra sin elegir y el escape de VoiceOver cierra', () => {
    const { getByTestId, onClose, onElegir } = montar(3);
    fireEvent.press(getByTestId('ab-velo'));
    act(() => { getByTestId('ab').props.onAccessibilityEscape(); });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('el pie se muestra junto a la fila cuando se pide, y no si no', () => {
    expect(montar(3, { pie: 'Se crea solo' }).getByText('Se crea solo')).toBeTruthy();
    expect(montar(3).queryByText('Se crea solo')).toBeNull();
  });

  it('el contenido de fecha dibuja día y mes en el cubo', () => {
    const r = montar(1, { opciones: [{ valor: 'd', fecha: { dia: '18', mes: 'nov' }, tinte: '#08f', etiqueta: 'mié 18' }] });
    expect(r.getByText('18')).toBeTruthy();
    expect(r.getByText('nov')).toBeTruthy();
    expect(r.getByText('mié 18')).toBeTruthy();
  });
});
