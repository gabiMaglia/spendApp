import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { HojasDeGasto } from '@/src/screens/expense/components/HojasDeGasto';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { useUserStore } from '@/src/store/userStore';
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
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));

function hojas(abierta: 'fecha' | 'pagador') {
  const onClose = jest.fn();
  const onDateChange = jest.fn();
  const ui = render(
    <HojasDeGasto
      abierta={abierta} onClose={onClose} isEditMode={false}
      groups={[]} groupId="" onGroupChange={jest.fn()}
      members={['a', 'b']} payerId="a" onPayerChange={jest.fn()}
      date={new Date()} onDateChange={onDateChange} anclaFecha={{ current: null }}
      note="" onNoteChange={jest.fn()}
    />,
  );
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ui, onClose, onDateChange };
}

describe('hoja de fecha del gasto (T-282 t2)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('Aero: abre la fila de 7 días y elegir cambia la fecha y cierra', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: false });
    const { ui, onClose, onDateChange } = hojas('fecha');
    const items = ui.getAllByRole('menuitem');
    expect(items).toHaveLength(7);
    fireEvent.press(items[1]);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Clásico: sigue siendo la hoja con su título', () => {
    useSettingsStore.setState({ skin: 'default' });
    const { ui, onDateChange, onClose } = hojas('fecha');
    expect(ui.getByText('expense.expense_date')).toBeTruthy();
    expect(ui.queryAllByRole('menuitem')).toHaveLength(0);
    fireEvent.press(ui.getAllByText('common.today')[0]);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('las otras hojas siguen igual: «quién pagó» lista a los miembros y elegir cierra', () => {
    useSettingsStore.setState({ skin: 'aero' });
    useUserStore.setState({ users: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }] } as never);
    const { ui, onClose } = hojas('pagador');
    expect(ui.getByText('expense.who_paid')).toBeTruthy();
    fireEvent.press(ui.getByText('Beto'));
    expect(onClose).toHaveBeenCalled();
  });
});
