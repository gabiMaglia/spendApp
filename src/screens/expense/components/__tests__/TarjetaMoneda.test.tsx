import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TarjetaDescripcionMonto } from '../TarjetaDescripcionMonto';
import { HeroMonto } from '../HeroMonto';
import { SUPPORTED_CURRENCIES } from '@/src/constants/currencies';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import es from '@/src/i18n/locales/es.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/src/components/menu/useRectAncla', () => require('@/src/test-utils/rectAnclaFalso').rectAnclaFalso);
jest.mock('@/src/utils/haptics', () => ({ hapticSelection: jest.fn() }));

const base = {
  category: 'food' as const, isIncome: false, currency: 'ARS' as const, description: '',
  onDescriptionChange: jest.fn(), amount: '', onAmountChange: jest.fn(), onAmountBlur: jest.fn(),
};

describe('moneda del gasto personal con abanico (T-286, Aero)', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const abrir = () => {
    fireEvent.press(screen.getByLabelText('expense.currency_change'));
    act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  };

  it('tocar la ficha saca las 9 monedas como cápsulas «CODE · nombre» y marca la actual', () => {
    render(<TarjetaDescripcionMonto {...base} onCurrencyChange={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('expense.currency_change'));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(SUPPORTED_CURRENCIES.length);
    expect(screen.getByLabelText('PYG · currency_names.PYG')).toBeTruthy();
    const marcados = items.filter(i => i.props.accessibilityState.selected);
    expect(marcados).toHaveLength(1);
    expect(marcados[0].props.accessibilityLabel).toBe('ARS · currency_names.ARS');
    // No se abre la hoja de siempre.
    expect(screen.queryByText('expense.currency_title')).toBeNull();
  });

  it('elegir PYG avisa el código y recoge el abanico', () => {
    const onCurrencyChange = jest.fn();
    render(<TarjetaDescripcionMonto {...base} onCurrencyChange={onCurrencyChange} />);
    abrir();
    fireEvent.press(screen.getByLabelText('PYG · currency_names.PYG'));
    expect(onCurrencyChange).toHaveBeenCalledTimes(1);
    expect(onCurrencyChange).toHaveBeenCalledWith('PYG');
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('con PYG la ficha muestra ₲/PYG y el aviso de sin decimales', () => {
    render(<TarjetaDescripcionMonto {...base} currency="PYG" amount="12,5" sinDecimales onCurrencyChange={jest.fn()} />);
    expect(screen.getByText('₲')).toBeTruthy();
    expect(screen.getByText('PYG')).toBeTruthy();
    expect(screen.getByTestId('amount-no-decimals')).toBeTruthy();
  });

  it('gasto de grupo: la ficha es inerte y no abre nada', () => {
    render(<TarjetaDescripcionMonto {...base} />);
    expect(screen.queryByLabelText('expense.currency_change')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('la categoría sigue abriendo su abanico aparte', () => {
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={jest.fn()} onCurrencyChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('selector-categoria-boton'));
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('PYG · currency_names.PYG')).toBeNull();
  });
});

describe('Clásico conserva la hoja de monedas (T-286)', () => {
  it('HeroMonto abre CurrencySheet, no el abanico', () => {
    render(<HeroMonto
      currency="ARS" value="" onChangeText={jest.fn()} onBlur={jest.fn()} onCurrencyChange={jest.fn()}
      incomeAllowed={false} isIncome={false} onKindChange={jest.fn()}
    />);
    fireEvent.press(screen.getByLabelText('expense.currency_change'));
    expect(screen.getByText('expense.currency_title')).toBeTruthy();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});

describe('claves de nombres de moneda (T-286)', () => {
  it('existen para las 9 monedas', () => {
    for (const c of SUPPORTED_CURRENCIES) expect(es.currency_names[c.code]).toBeTruthy();
  });
});
