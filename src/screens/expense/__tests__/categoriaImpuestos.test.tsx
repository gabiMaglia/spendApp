import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { GrillaCategorias } from '@/src/screens/expense/components/GrillaCategorias';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { Colors } from '@/src/constants/colors';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

/** Categoría «Impuestos» (PO 2026-11-03), al lado de «Servicios» en la grilla. */
describe('categoría Impuestos', () => {
  it('está en la grilla, justo después de Servicios', () => {
    const ids = CATEGORIES.map(c => c.id);
    expect(ids.indexOf('taxes')).toBe(ids.indexOf('utilities') + 1);
  });

  it('tiene nombre en es, en y pt', () => {
    expect(es.categories.taxes).toBe('Impuestos');
    expect(en.categories.taxes).toBe('Taxes');
    expect(pt.categories.taxes).toBe('Impostos');
  });

  it('tiene color propio en claro y oscuro', () => {
    expect(Colors.light.category.taxes).toBeDefined();
    expect(Colors.dark.category.taxes).toBeDefined();
  });

  it('se puede elegir en la grilla', () => {
    const onChange = jest.fn();
    const { getByText } = render(<GrillaCategorias value="food" onChange={onChange} />);
    fireEvent.press(getByText('categories.taxes'));
    expect(onChange).toHaveBeenCalledWith('taxes');
  });

  it('el ícono la reconoce (no cae en «Otros»)', () => {
    expect(() => render(<CategoryIcon kind="taxes" />)).not.toThrow();
  });
});
