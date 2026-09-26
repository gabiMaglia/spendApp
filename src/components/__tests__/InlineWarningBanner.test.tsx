import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { InlineWarningBanner } from '../InlineWarningBanner';

/**
 * Se extrae al segundo repetido (ronda de borrado consensuado +
 * autoría en disputa, T-170 · D-3): ambas bandas de aviso comparten layout.
 * Comportamiento, no estilos (regla del proyecto): qué se renderiza según
 * props, nunca tamaños/colores.
 */
describe('InlineWarningBanner', () => {
  it('muestra el título siempre', () => {
    const { getByText } = render(<InlineWarningBanner icon="alert-circle-outline" title="Título" />);
    expect(getByText('Título')).toBeTruthy();
  });

  it('muestra el cuerpo sólo si se pasa', () => {
    const { getByText, queryByText, rerender } = render(
      <InlineWarningBanner icon="alert-circle-outline" title="Título" body="Cuerpo" />,
    );
    expect(getByText('Cuerpo')).toBeTruthy();

    rerender(<InlineWarningBanner icon="alert-circle-outline" title="Título" />);
    expect(queryByText('Cuerpo')).toBeNull();
  });

  it('renderiza los children extra debajo del cuerpo', () => {
    const { getByText } = render(
      <InlineWarningBanner icon="alert-circle-outline" title="Título">
        <Text>Extra</Text>
      </InlineWarningBanner>,
    );
    expect(getByText('Extra')).toBeTruthy();
  });
});
