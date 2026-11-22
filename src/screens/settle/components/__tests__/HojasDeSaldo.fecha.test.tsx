import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { HojasDeSaldo } from '@/src/screens/settle/components/HojasDeSaldo';
import { FilasGrupoYFecha } from '@/src/screens/settle/components/FilasGrupoYFecha';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
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

function hojas() {
  const onCloseDate = jest.fn();
  const onDateChange = jest.fn();
  const ui = render(
    <HojasDeSaldo
      isPrefilled
      showGroup={false} onCloseGroup={jest.fn()} groups={[]} groupId="" onGroupChange={jest.fn()}
      showFrom={false} onCloseFrom={jest.fn()} members={[]} fromId="" onFromChange={jest.fn()}
      showTo={false} onCloseTo={jest.fn()} toOptions={[]} toId="" onToChange={jest.fn()}
      showDate onCloseDate={onCloseDate} date={new Date()} onDateChange={onDateChange}
      anclaFecha={{ current: null }} hintDe={() => undefined}
    />,
  );
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ui, onCloseDate, onDateChange };
}

describe('fecha de Saldar (T-282 t2)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('Aero: fila de 7 días; elegir cambia la fecha y CIERRA', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: false });
    const { ui, onCloseDate, onDateChange } = hojas();
    const items = ui.getAllByRole('menuitem');
    expect(items).toHaveLength(7);
    fireEvent.press(items[2]);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onCloseDate).toHaveBeenCalledTimes(1);
  });

  it('Clásico: la hoja con su título; elegir cambia la fecha y CIERRA', () => {
    useSettingsStore.setState({ skin: 'default' });
    const { ui, onCloseDate, onDateChange } = hojas();
    expect(ui.getByText('settle.payment_date')).toBeTruthy();
    expect(ui.queryAllByRole('menuitem')).toHaveLength(0);
    fireEvent.press(ui.getAllByText('common.today')[0]);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onCloseDate).toHaveBeenCalledTimes(1);
  });

  it('la fecha larga sale en el idioma activo (nunca un locale fijo)', () => {
    useSettingsStore.setState({ skin: 'default' });
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString');
    hojas();
    const idiomas = spy.mock.calls.map(c => c[0]);
    expect(idiomas.length).toBeGreaterThan(0);
    expect(idiomas.every(i => i === 'es')).toBe(true);
    spy.mockRestore();
  });
});

describe('FilasGrupoYFecha: ancla de la fecha', () => {
  it('el ref llega a un host medible y la fila abre la fecha', () => {
    const anclaFecha = React.createRef<any>();
    const onPressFecha = jest.fn();
    const { getByText } = render(
      <FilasGrupoYFecha
        nombreGrupo="Viaje" date={new Date()} anclaFecha={anclaFecha}
        onPressGrupo={jest.fn()} onPressFecha={onPressFecha}
      />,
    );
    expect(typeof anclaFecha.current?.measureInWindow).toBe('function');
    fireEvent.press(getByText('settle.date_label'));
    expect(onPressFecha).toHaveBeenCalled();
  });
});
