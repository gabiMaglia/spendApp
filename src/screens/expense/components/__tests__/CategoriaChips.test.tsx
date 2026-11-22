import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CategoriaChips } from '@/src/screens/expense/components/DescripcionYCategorias';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';

jest.mock('@/src/utils/haptics', () => ({ hapticSeleccionar: jest.fn(), hapticAbrir: jest.fn() }));

describe('grilla de categorías (T-293)', () => {
  it('la elegida va en variante b y las demás en a', () => {
    render(<CategoriaChips value="shopping" onChange={jest.fn()} />);
    expect(screen.getByTestId('icono-categoria-shopping-b')).toBeTruthy();
    const otras = CATEGORIES.filter(c => c.id !== 'shopping');
    for (const c of otras) {
      expect(screen.getByTestId(`icono-categoria-${c.id}-a`)).toBeTruthy();
    }
  });

  it('marca la elegida como seleccionada y tocar otra llama onChange', () => {
    const onChange = jest.fn();
    render(<CategoriaChips value="food" onChange={onChange} />);
    expect(screen.getByLabelText('categories.food').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText('categories.transport'));
    expect(onChange).toHaveBeenCalledWith('transport');
  });
});
