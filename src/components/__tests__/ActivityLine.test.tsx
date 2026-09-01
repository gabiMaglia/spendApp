import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityLine } from '../ActivityLine';

/**
 * La línea del feed dice tres cosas: quién, qué hizo y sobre qué. Estaba
 * copiada en tres filas y al cuarto uso se extrajo (T-041 · S8).
 */
describe('ActivityLine', () => {
  it('muestra quién, qué hizo, sobre qué y cuándo', () => {
    const { getByText } = render(
      <ActivityLine who="Beto" action="restauró" subject="“Nafta” · Viaje" ts="hace 2 h" />,
    );

    expect(getByText('Beto')).toBeTruthy();
    expect(getByText('“Nafta” · Viaje')).toBeTruthy();
    expect(getByText('hace 2 h')).toBeTruthy();
  });

  /**
   * No llama a `t()` adentro: el copy lo decide la pantalla, que es la que sabe
   * si el sujeto va entre comillas. Un reusable que traduce por su cuenta deja
   * de servir para el segundo caso.
   */
  it('no traduce nada: renderiza el texto que le pasan tal cual', () => {
    const { getByText } = render(
      <ActivityLine who="X" action="activity.action_restored" subject="s" ts="t" />,
    );

    expect(getByText(/activity\.action_restored/)).toBeTruthy();
  });
});
