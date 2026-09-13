import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { CollapsibleHeader, DetailHeader } from '../CollapsibleHeader';

/**
 * T-105 — el mármol tiene que vivir DENTRO de los headers compartidos, no
 * pegado a mano en cada pantalla. Si el día de mañana `CollapsibleHeader` o
 * `DetailHeader` dejan de montar `FondoMarmol`, este test es el que avisa —
 * sin depender de cómo se ve la imagen (T-105 no testea estilos).
 */
describe('el mármol vive en los headers compartidos', () => {
  it('CollapsibleHeader monta FondoMarmol detrás del contenido', () => {
    const r = render(<CollapsibleHeader title="Test" scrollY={new Animated.Value(0)} />);
    expect(r.UNSAFE_queryAllByType(Image).length).toBeGreaterThan(0);
  });

  it('DetailHeader monta FondoMarmol detrás del contenido', () => {
    const r = render(<DetailHeader title="Test" onBack={() => {}} />);
    expect(r.UNSAFE_queryAllByType(Image).length).toBeGreaterThan(0);
  });
});
