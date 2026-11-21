import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { VerMasFooter } from '@/src/components/VerMasFooter';

describe('VerMasFooter', () => {
  it('muestra la etiqueta y dispara la acción', () => {
    const onPress = jest.fn();
    const { getByText } = render(<VerMasFooter label="Ver más (45)" onPress={onPress} />);
    fireEvent.press(getByText('Ver más (45)'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
