import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MontoEditable } from '@/src/components/MontoEditable';

describe('MontoEditable (T-113)', () => {
  it('muestra el símbolo de la moneda elegida, no un $ fijo', () => {
    const usd = render(<MontoEditable testID="m" currency="USD" value="" onChangeText={jest.fn()} />);
    expect(usd.getByTestId('m-simbolo').props.children).toBe('US$');
    const eur = render(<MontoEditable testID="m" currency="EUR" value="" onChangeText={jest.fn()} />);
    expect(eur.getByTestId('m-simbolo').props.children).toBe('€');
  });

  it('vacío muestra el 0 de placeholder y avisa lo que se escribe', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<MontoEditable testID="m" currency="ARS" value="" onChangeText={onChange} />);
    expect(getByTestId('m').props.placeholder).toBe('0');
    fireEvent.changeText(getByTestId('m'), '1500');
    expect(onChange).toHaveBeenCalledWith('1500');
  });
});
