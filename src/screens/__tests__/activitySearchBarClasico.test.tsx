import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActivitySearchBar } from '@/src/screens/activity/components/ActivitySearchBar';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * T-203: la barra de búsqueda de Actividad rompía con el diseño en Clásico
 * (pastilla con fondo y borde redondeado, pensada para Aero). Rediseño
 * "línea del libro" SOLO en Clásico — Aero no se toca (separado por
 * `useSkinTokens().flags.soft`, mismo patrón que `RecurrencePicker.tsx`).
 * Test de comportamiento: presencia del input, el clear condicionado al
 * texto, y el estado de foco expuesto sin mirar colores.
 */

beforeEach(() => {
  useSettingsStore.setState({ skin: 'default' });
});

describe('ActivitySearchBar en Clásico', () => {
  it('renderiza el input de búsqueda', () => {
    const r = render(<ActivitySearchBar value="" onChangeText={jest.fn()} />);
    expect(r.getByTestId('activity-search')).toBeTruthy();
  });

  it('el botón de limpiar sólo aparece con texto, y lo borra al tocarlo', () => {
    const onChangeText = jest.fn();
    const r = render(<ActivitySearchBar value="" onChangeText={onChangeText} />);
    expect(r.queryByTestId('activity-search-clear')).toBeNull();

    r.rerender(<ActivitySearchBar value="café" onChangeText={onChangeText} />);
    const clear = r.getByTestId('activity-search-clear');
    fireEvent.press(clear);
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('al enfocar, el contenedor expone el foco sin mirar colores; al soltar, vuelve', () => {
    const r = render(<ActivitySearchBar value="" onChangeText={jest.fn()} />);
    const linea = r.getByTestId('activity-search-line');
    const input = r.getByTestId('activity-search');

    expect(linea.props.accessibilityState?.selected).toBe(false);

    fireEvent(input, 'focus');
    expect(r.getByTestId('activity-search-line').props.accessibilityState?.selected).toBe(true);

    fireEvent(input, 'blur');
    expect(r.getByTestId('activity-search-line').props.accessibilityState?.selected).toBe(false);
  });
});
