import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { CuboIcono, CUBO_TAMANO } from '@/src/components/CuboIcono';

describe('CuboIcono', () => {
  it('dibuja el ícono pedido', () => {
    const { UNSAFE_getByProps } = render(<CuboIcono icono="restaurant-outline" tinte="#ff8800" />);
    expect(UNSAFE_getByProps({ name: 'restaurant-outline' })).toBeTruthy();
  });

  it('es un cuadrado de CUBO_TAMANO (lo usa el abanico para alinearse con el original)', () => {
    const { getByTestId } = render(<CuboIcono icono="car-outline" tinte="#123456" testID="cubo" />);
    const e = StyleSheet.flatten(getByTestId('cubo').props.style);
    expect([e.width, e.height]).toEqual([CUBO_TAMANO, CUBO_TAMANO]);
  });
});

describe('CuboIcono con texto (T-286)', () => {
  it('con `texto` dibuja el texto y no el ícono', () => {
    const { getByText, UNSAFE_queryByProps } = render(<CuboIcono texto="₲" tinte="#123456" />);
    expect(getByText('₲')).toBeTruthy();
    expect(UNSAFE_queryByProps({ size: 28 })).toBeNull();
  });
});
