import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TarjetaDescripcionMonto } from '../TarjetaDescripcionMonto';

const base = {
  category: 'other' as const, isIncome: false, currency: 'ARS' as const, description: '',
  onDescriptionChange: jest.fn(), amount: '', onAmountChange: jest.fn(), onAmountBlur: jest.fn(),
};

describe('badge de moneda del gasto (T-255)', () => {
  it('sin onCurrencyChange (con grupo) no es tocable', () => {
    render(<TarjetaDescripcionMonto {...base} />);
    expect(screen.queryByLabelText('expense.currency_change')).toBeNull();
  });

  it('sin grupo abre las 9 monedas y elegir una avisa el código', () => {
    const onCurrencyChange = jest.fn();
    render(<TarjetaDescripcionMonto {...base} onCurrencyChange={onCurrencyChange} />);
    fireEvent.press(screen.getByLabelText('expense.currency_change'));
    expect(screen.getAllByText(/^\S+\s+(USD|EUR|ARS|BRL|CLP|BOB|PYG|UYU|PEN)$/)).toHaveLength(9);
    fireEvent.press(screen.getByText('$  CLP'));
    expect(onCurrencyChange).toHaveBeenCalledWith('CLP');
  });
});
