import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { HojaFecha } from '@/src/components/HojaFecha';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import { useSettingsStore } from '@/src/store/settingsStore';

let mockIdioma = 'es';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: mockIdioma, changeLanguage: jest.fn() } }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
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

function montar(extra: Partial<React.ComponentProps<typeof HojaFecha>> = {}) {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const r = render(
    <HojaFecha
      visible onClose={onClose} ancla={{ current: null }} date={new Date()} onElegir={onElegir}
      titulo="expense.expense_date" testID="hf" {...extra}
    />,
  );
  act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  return { ...r, onClose, onElegir };
}

describe('HojaFecha — Aero (fila de cubos)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIdioma = 'es';
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: false });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('ofrece 7 días; hoy y ayer con su palabra, y la fecha actual queda seleccionada', () => {
    const r = montar();
    const items = r.getAllByRole('menuitem');
    expect(items).toHaveLength(7);
    expect(items[0].props.accessibilityLabel).toBe('common.today');
    expect(items[1].props.accessibilityLabel).toBe('common.yesterday');
    expect(items.map(i => !!i.props.accessibilityState?.selected)).toEqual([true, false, false, false, false, false, false]);
  });

  it('elegir el 3º día llama onElegir con ese día una vez y cierra', () => {
    const r = montar();
    const tercero = new Date(); tercero.setDate(tercero.getDate() - 2);
    fireEvent.press(r.getAllByRole('menuitem')[2]);
    expect(r.onElegir).toHaveBeenCalledTimes(1);
    expect(r.onElegir.mock.calls[0][0].toDateString()).toBe(tercero.toDateString());
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });

  it('soloMesCorriente recorta a los días del mes', () => {
    jest.setSystemTime(new Date(2026, 10, 3, 10));
    expect(montar({ soloMesCorriente: true, date: new Date(2026, 10, 3) }).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('usa el idioma activo, nunca es-AR', () => {
    mockIdioma = 'en';
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString');
    montar();
    const idiomas = spy.mock.calls.map(c => c[0]);
    expect(idiomas.length).toBeGreaterThan(0);
    expect(idiomas.every(i => i === 'en')).toBe(true);
    spy.mockRestore();
  });

  it('cerrada no monta nada', () => {
    expect(montar({ visible: false }).queryAllByRole('menuitem')).toHaveLength(0);
  });
});

describe('HojaFecha — Clásico (hoja)', () => {
  beforeEach(() => { jest.useFakeTimers(); useSettingsStore.setState({ skin: 'default' }); });
  afterEach(() => { jest.useRealTimers(); });

  it('sigue siendo la hoja con su título, y elegir llama onElegir y CIERRA', () => {
    const r = montar();
    expect(r.getByText('expense.expense_date')).toBeTruthy();
    expect(r.queryAllByRole('menuitem')).toHaveLength(0);
    fireEvent.press(r.getAllByText('common.yesterday')[0]);
    expect(r.onElegir).toHaveBeenCalledTimes(1);
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });
});
