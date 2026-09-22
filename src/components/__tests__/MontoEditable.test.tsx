import React, { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TextInput } from 'react-native';
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

  // PO 2026-09-22: tocar en cualquier parte del bloque (no sólo sobre los
  // dígitos, que con el placeholder "0" es un área angosta) tiene que abrir
  // el teclado — antes sólo el TextInput en sí respondía al toque.
  it('tocar en cualquier parte del bloque enfoca el input, no sólo los dígitos', () => {
    const ref = createRef<TextInput>();
    const focusSpy = jest.fn();
    const { getByTestId } = render(
      <MontoEditable ref={ref} testID="m" currency="ARS" value="" onChangeText={jest.fn()} />,
    );
    // El TextInput real no monta su instancia nativa en Jest; se verifica que
    // el toque en el área SÍ intenta enfocar el ref, no que el foco nativo
    // ocurra (imposible de observar en este entorno).
    if (ref.current) ref.current.focus = focusSpy;
    fireEvent.press(getByTestId('m-tap-area'));
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
