import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { HojasSplitwise } from '@/src/screens/expense/components/HojasSplitwise';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import type { RecurrenceValue } from '@/src/components/RecurrencePicker';
import { useSettingsStore } from '@/src/store/settingsStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/src/components/menu/useRectAncla', () => require('@/src/test-utils/rectAnclaFalso').rectAnclaFalso);
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

function repetir(recurrence: RecurrenceValue = null, abierta: 'repetir' | null = 'repetir') {
  const onClose = jest.fn();
  const onRecurrenceChange = jest.fn();
  const ui = render(
    <HojasSplitwise
      abierta={abierta} onClose={onClose}
      members={['a', 'b']} payerId="a" onPayerChange={jest.fn()}
      multiPayer={false} payers={[]} amount={1000} currency="ARS"
      onPayersChange={jest.fn()} onTogglePayerMode={jest.fn()}
      reparto={{} as never} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange}
      anclaRepetir={{ current: null }}
    />,
  );
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ui, onClose, onRecurrenceChange };
}

describe('Repetir en Aero: fila de cubos (T-282 t2)', () => {
  beforeEach(() => { jest.useFakeTimers(); useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }); });
  afterEach(() => { jest.useRealTimers(); });

  it('fila con las 5 opciones y «Una vez» seleccionada cuando no se repite', () => {
    const { ui } = repetir(null);
    expect(ui.getByTestId('menu-repetir').props.accessibilityRole).toBe('menu');
    const items = ui.getAllByRole('menuitem');
    expect(items).toHaveLength(5);
    expect(items.filter(i => i.props.accessibilityState.selected)).toHaveLength(1);
    expect(items[0].props.accessibilityState.selected).toBe(true);
    expect(ui.getByText('recurrence.once')).toBeTruthy();
  });

  it('la frecuencia actual aparece seleccionada', () => {
    const { ui } = repetir('monthly');
    const items = ui.getAllByRole('menuitem');
    expect(items.filter(i => i.props.accessibilityState.selected)).toEqual([items[3]]);
  });

  it('muestra la pista de recurrence.hint como pie', () => {
    expect(repetir(null).ui.getByText('recurrence.hint')).toBeTruthy();
  });

  it('elegir una frecuencia la guarda y cierra una sola vez', () => {
    const { ui, onClose, onRecurrenceChange } = repetir(null);
    fireEvent.press(ui.getByText('recurrence.weekly'));
    expect(onRecurrenceChange).toHaveBeenCalledTimes(1);
    expect(onRecurrenceChange).toHaveBeenCalledWith('weekly');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('elegir «Una vez» vuelve a null', () => {
    const { ui, onRecurrenceChange } = repetir('weekly');
    fireEvent.press(ui.getByText('recurrence.once'));
    expect(onRecurrenceChange).toHaveBeenCalledWith(null);
  });

  it('tocar el velo cierra sin cambiar nada', () => {
    const { ui, onClose, onRecurrenceChange } = repetir('weekly');
    fireEvent.press(ui.getByTestId('menu-repetir-velo'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRecurrenceChange).not.toHaveBeenCalled();
  });

  it('con otra hoja abierta no hay fila de Repetir', () => {
    expect(repetir(null, null).ui.queryAllByRole('menuitem')).toHaveLength(0);
  });
});
