import React from 'react';
import { render, screen } from '@testing-library/react-native';

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

  // Aero abre el abanico (T-286); la hoja de siempre queda en Clásico (HeroMonto.test).
  it('sin grupo es un botón', () => {
    render(<TarjetaDescripcionMonto {...base} onCurrencyChange={jest.fn()} />);
    expect(screen.getByLabelText('expense.currency_change').props.accessibilityRole).toBe('button');
  });
});

describe('monto con centavos en una moneda sin decimales (T-258)', () => {
  it('muestra el aviso sólo cuando corresponde', () => {
    const { rerender } = render(<TarjetaDescripcionMonto {...base} currency="CLP" amount="12,50" sinDecimales />);
    expect(screen.getByTestId('amount-no-decimals')).toBeTruthy();
    rerender(<TarjetaDescripcionMonto {...base} currency="CLP" amount="12" />);
    expect(screen.queryByTestId('amount-no-decimals')).toBeNull();
  });
});
