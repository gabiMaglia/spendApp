import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SelectorCategoria } from '@/src/screens/expense/components/SelectorCategoria';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { useSettingsStore } from '@/src/store/settingsStore';
import { hapticSelection } from '@/src/utils/haptics';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@/src/utils/haptics', () => ({ hapticSelection: jest.fn() }));

describe('SelectorCategoria', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ skin: 'aero' }); // en Aero abre el menú anclado
  });

  it('muestra el nombre de la categoría actual y no el menú', () => {
    const { getByText, queryByText } = render(<SelectorCategoria value="food" onChange={jest.fn()} />);
    expect(getByText('categories.food')).toBeTruthy();
    expect(queryByText('categories.taxes')).toBeNull();
  });

  it('el disparador es un botón con etiqueta y estado expandido', () => {
    const { getByRole } = render(<SelectorCategoria value="food" onChange={jest.fn()} />);
    const boton = getByRole('button');
    expect(boton.props.accessibilityLabel).toContain('expense.category_selector_label');
    expect(boton.props.accessibilityState.expanded).toBe(false);
    fireEvent.press(boton);
    expect(getByRole('button').props.accessibilityState.expanded).toBe(true);
  });

  it('abre el menú con las categorías de gasto y la actual seleccionada', () => {
    const { getByRole, getAllByRole } = render(<SelectorCategoria value="food" onChange={jest.fn()} />);
    fireEvent.press(getByRole('button'));
    const items = getAllByRole('menuitem');
    expect(items).toHaveLength(CATEGORIES.length);
    expect(items.filter(i => i.props.accessibilityState.selected)).toHaveLength(1);
  });

  it('elegir otra categoría llama onChange, da feedback háptico y cierra', () => {
    const onChange = jest.fn();
    const { getByRole, getAllByText, queryAllByRole } = render(<SelectorCategoria value="food" onChange={onChange} />);
    fireEvent.press(getByRole('button'));
    fireEvent.press(getAllByText('categories.taxes')[0]);
    expect(onChange).toHaveBeenCalledWith('taxes');
    expect(hapticSelection).toHaveBeenCalledTimes(1);
    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('elegir la misma no da háptico', () => {
    const { getByRole, getAllByText } = render(<SelectorCategoria value="food" onChange={jest.fn()} />);
    fireEvent.press(getByRole('button'));
    fireEvent.press(getAllByText('categories.food')[1]);
    expect(hapticSelection).not.toHaveBeenCalled();
  });

  it('tocar el velo no cambia nada', () => {
    const onChange = jest.fn();
    const { getByRole, getByTestId } = render(<SelectorCategoria value="food" onChange={onChange} />);
    fireEvent.press(getByRole('button'));
    fireEvent.press(getByTestId('selector-categoria-velo'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('la etiqueta de accesibilidad existe en es, en y pt', () => {
    for (const l of [es, en, pt]) expect(l.expense.category_selector_label).toBeTruthy();
  });
});
