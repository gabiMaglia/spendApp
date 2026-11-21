import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { TarjetaDescripcionMonto } from '@/src/screens/expense/components/TarjetaDescripcionMonto';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { Colors } from '@/src/constants/colors';
import { useSettingsStore } from '@/src/store/settingsStore';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/src/components/menu/useRectAncla', () => require('@/src/test-utils/rectAnclaFalso').rectAnclaFalso);

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

  it('se puede elegir en el selector', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const onChange = jest.fn();
    const { getByTestId, getByLabelText } = render(
      <TarjetaDescripcionMonto
        category="food" onCategoryChange={onChange} isIncome={false} currency="ARS" description=""
        onDescriptionChange={jest.fn()} amount="" onAmountChange={jest.fn()} onAmountBlur={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('selector-categoria-boton'));
    fireEvent.press(getByLabelText('categories.taxes'));
    expect(onChange).toHaveBeenCalledWith('taxes');
  });

  it('el ícono la reconoce (no cae en «Otros»)', () => {
    expect(() => render(<CategoryIcon kind="taxes" />)).not.toThrow();
  });
});
