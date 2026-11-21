import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TarjetaDescripcionMonto } from '../TarjetaDescripcionMonto';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { ASENTAR_MS } from '@/src/components/menu/AbanicoCubos';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';
import { hapticSelection } from '@/src/utils/haptics';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/src/components/menu/useRectAncla', () => require('@/src/test-utils/rectAnclaFalso').rectAnclaFalso);
jest.mock('@/src/utils/haptics', () => ({ hapticSelection: jest.fn() }));

const base = {
  category: 'food' as const, isIncome: false, currency: 'ARS' as const, description: '',
  onDescriptionChange: jest.fn(), amount: '', onAmountChange: jest.fn(), onAmountBlur: jest.fn(),
};

describe('cubo de categoría de la tarjeta (T-283)', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /** Abre el cubo y espera a que la entrada asiente (antes no recibe toques). */
  const abrir = () => {
    fireEvent.press(screen.getByTestId('selector-categoria-boton'));
    act(() => { jest.advanceTimersByTime(ASENTAR_MS + 50); });
  };

  it('en gasto el cubo es un botón con la categoría y sin el abanico abierto', () => {
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={jest.fn()} />);
    const cubo = screen.getByTestId('selector-categoria-boton');
    expect(cubo.props.accessibilityRole).toBe('button');
    expect(cubo.props.accessibilityLabel).toContain('categories.food');
    expect(cubo.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('tocarlo abre las categorías, una por cubo con su nombre, y marca la actual', () => {
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('selector-categoria-boton'));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(CATEGORIES.length);
    expect(items.filter(i => i.props.accessibilityState.selected)).toHaveLength(1);
    expect(screen.getByTestId('selector-categoria-boton').props.accessibilityState.expanded).toBe(true);
  });

  it('elegir otra llama onCategoryChange, da háptico y recoge', () => {
    const onCategoryChange = jest.fn();
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={onCategoryChange} />);
    abrir();
    fireEvent.press(screen.getByLabelText('categories.taxes'));
    expect(onCategoryChange).toHaveBeenCalledWith('taxes');
    expect(hapticSelection).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('elegir la misma no da háptico', () => {
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={jest.fn()} />);
    abrir();
    fireEvent.press(screen.getByLabelText('categories.food'));
    expect(hapticSelection).not.toHaveBeenCalled();
  });

  it('el velo cierra sin cambiar la categoría', () => {
    const onCategoryChange = jest.fn();
    render(<TarjetaDescripcionMonto {...base} onCategoryChange={onCategoryChange} />);
    fireEvent.press(screen.getByTestId('selector-categoria-boton'));
    fireEvent.press(screen.getByTestId('selector-categoria-velo'));
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('un toque durante la apertura (doble toque sobre el cubo) no cambia la categoría', () => {
    const onCategoryChange = jest.fn();
    render(<TarjetaDescripcionMonto {...base} category="other" onCategoryChange={onCategoryChange} />);
    fireEvent.press(screen.getByTestId('selector-categoria-boton'));
    fireEvent.press(screen.getAllByRole('menuitem')[0]); // cae sobre el ancla, aún sin asentar
    expect(onCategoryChange).not.toHaveBeenCalled();
  });

  it('la etiqueta de accesibilidad del cubo existe en es, en y pt', () => {
    for (const l of [es, en, pt]) expect(l.expense.category_selector_label).toBeTruthy();
  });

  it('en ingreso el cubo no abre nada y no es un botón', () => {
    render(<TarjetaDescripcionMonto {...base} isIncome onCategoryChange={jest.fn()} />);
    expect(screen.queryByTestId('selector-categoria-boton')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('sin onCategoryChange (nadie la puede cambiar) el cubo es sólo ícono', () => {
    render(<TarjetaDescripcionMonto {...base} />);
    expect(screen.queryByTestId('selector-categoria-boton')).toBeNull();
  });
});
