import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HeroMonto } from '../HeroMonto';

const base = {
  currency: 'ARS' as const, value: '', onChangeText: jest.fn(), onBlur: jest.fn(),
  incomeAllowed: false, isIncome: false, onKindChange: jest.fn(),
};

describe('moneda del héroe Clásico (T-255)', () => {
  it('con grupo (sin onCurrencyChange) no es tocable', () => {
    render(<HeroMonto {...base} />);
    expect(screen.queryByLabelText('expense.currency_change')).toBeNull();
  });

  it('sin grupo abre las 9 monedas y elegir una avisa el código', () => {
    const onCurrencyChange = jest.fn();
    render(<HeroMonto {...base} onCurrencyChange={onCurrencyChange} />);
    fireEvent.press(screen.getByLabelText('expense.currency_change'));
    expect(screen.getByText('expense.currency_title')).toBeTruthy();
    expect(screen.getAllByText(/^\S+\s+(USD|EUR|ARS|BRL|CLP|BOB|PYG|UYU|PEN)$/)).toHaveLength(9);
    fireEvent.press(screen.getByText('$  CLP'));
    expect(onCurrencyChange).toHaveBeenCalledWith('CLP');
  });
});

describe('monto con centavos en una moneda sin decimales (T-258)', () => {
  it('muestra el aviso sólo cuando corresponde', () => {
    const { rerender } = render(<HeroMonto {...base} currency="CLP" value="12,50" sinDecimales />);
    expect(screen.getByTestId('amount-no-decimals')).toBeTruthy();
    rerender(<HeroMonto {...base} currency="CLP" value="12" />);
    expect(screen.queryByTestId('amount-no-decimals')).toBeNull();
  });
});
