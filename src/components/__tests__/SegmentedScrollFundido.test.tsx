import React from 'react';
import { ScrollView } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Segmented } from '../Band';
import { useSettingsStore } from '@/src/store/settingsStore';

jest.mock('@/src/utils/haptics', () => ({ hapticSeleccionar: jest.fn() }));

const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
const options = keys.map(k => ({ key: k, label: k }));
const ANCHO_VENTANA = 300;
const ANCHO_TAB = 100;

function montar(value = 'a', ancho = ANCHO_TAB * keys.length, skin: 'default' | 'aero' = 'default') {
  useSettingsStore.setState({ skin });
  const t = render(<Segmented variant="tabs" scroll options={options} value={value} onChange={() => {}} />);
  medir(t, ancho);
  return t;
}

function medir(t: ReturnType<typeof render>, ancho: number) {
  const sv = t.getByTestId('segmented-tabs-scroll');
  act(() => {
    fireEvent(sv, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: ANCHO_VENTANA, height: 48 } } });
    fireEvent(sv, 'contentSizeChange', ancho, 48);
    keys.forEach((k, i) => {
      fireEvent(t.getByText(k).parent!.parent!, 'layout', {
        nativeEvent: { layout: { x: i * ANCHO_TAB, y: 0, width: ANCHO_TAB, height: 48 } },
      });
    });
  });
}

const desplazar = (t: ReturnType<typeof render>, x: number) =>
  act(() => { fireEvent.scroll(t.getByTestId('segmented-tabs-scroll'), { nativeEvent: { contentOffset: { x } } }); });

const visible = (t: ReturnType<typeof render>, id: string) => {
  const n = t.queryByTestId(id);
  return !!n && n.props.accessibilityElementsHidden === false;
};

afterEach(() => { jest.restoreAllMocks(); });

describe('Segmented scroll: fundido en los bordes', () => {

  it('con contenido más ancho que la ventana hay fundido a la derecha y no a la izquierda', () => {
    const t = montar();
    expect(visible(t, 'segmented-fundido-derecha')).toBe(true);
    expect(visible(t, 'segmented-fundido-izquierda')).toBe(false);
  });

  it('al llegar al final se apaga el derecho', () => {
    const t = montar();
    desplazar(t, ANCHO_TAB * keys.length - ANCHO_VENTANA);
    expect(visible(t, 'segmented-fundido-derecha')).toBe(false);
    expect(visible(t, 'segmented-fundido-izquierda')).toBe(true);
  });

  it('scrolleado al medio se ven los dos', () => {
    const t = montar();
    desplazar(t, 100);
    expect(visible(t, 'segmented-fundido-derecha')).toBe(true);
    expect(visible(t, 'segmented-fundido-izquierda')).toBe(true);
  });

  it('si todo entra no hay fundido', () => {
    const t = montar('a', ANCHO_VENTANA);
    expect(visible(t, 'segmented-fundido-derecha')).toBe(false);
    expect(visible(t, 'segmented-fundido-izquierda')).toBe(false);
  });

  it('en Aero también', () => {
    const t = montar('a', ANCHO_TAB * keys.length, 'aero');
    expect(visible(t, 'segmented-fundido-derecha')).toBe(true);
    expect(visible(t, 'segmented-fundido-izquierda')).toBe(false);
  });
});

describe('Segmented scroll: la elegida se trae a la vista', () => {
  it('al montar con una pestaña lejana elegida hace scrollTo con x>0, sin animar', () => {
    const spy = jest.spyOn(ScrollView.prototype, 'scrollTo'); spy.mockClear();
    montar('f');
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[spy.mock.calls.length - 1][0] as { x: number; animated: boolean };
    expect(arg.x).toBeGreaterThan(0);
    expect(arg.animated).toBe(false);
  });

  it('con la primera elegida no hace falta mover nada (x=0)', () => {
    const spy = jest.spyOn(ScrollView.prototype, 'scrollTo'); spy.mockClear();
    montar('a');
    spy.mock.calls.forEach(c => expect((c[0] as { x: number }).x).toBe(0));
  });

  it('al cambiar value vuelve a hacer scrollTo, animado', async () => {
    const spy = jest.spyOn(ScrollView.prototype, 'scrollTo'); spy.mockClear();
    const t = montar('a');
    await act(async () => {}); // resuelve la consulta async de «reducir movimiento»
    spy.mockClear();
    t.rerender(<Segmented variant="tabs" scroll options={options} value="e" onChange={() => {}} />);
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[spy.mock.calls.length - 1][0] as { x: number; animated: boolean };
    expect(arg.x).toBeGreaterThan(0);
    expect(arg.animated).toBe(true);
  });
});
