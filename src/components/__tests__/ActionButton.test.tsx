import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ActionButton } from '../ActionButton';
import { ButtonRack } from '../ButtonRack';

describe('ActionButton', () => {
  it('muestra el label y dispara la accion', () => {
    const action = jest.fn();
    const { getByText } = render(<ActionButton action={action} label="Saldar" />);
    fireEvent.press(getByText('Saldar'));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado no dispara nada', () => {
    const action = jest.fn();
    const { getByText } = render(<ActionButton action={action} label="Saldar" disabled />);
    fireEvent.press(getByText('Saldar'));
    expect(action).not.toHaveBeenCalled();
  });

  it('cargando tampoco dispara: evita el doble toque', () => {
    const action = jest.fn();
    const { getByTestId } = render(
      <ActionButton action={action} label="Saldar" loading testID="b" />,
    );
    fireEvent.press(getByTestId('b'));
    expect(action).not.toHaveBeenCalled();
  });

  it('muestra el sublabel cuando se le pasa', () => {
    const { getByText } = render(
      <ActionButton action={() => {}} label="Saldar" sub="toda la deuda" />,
    );
    expect(getByText('toda la deuda')).toBeTruthy();
  });

  it('el accessibilityLabel cae al label si no se especifica otro', () => {
    const { getByLabelText } = render(<ActionButton action={() => {}} label="Saldar" />);
    expect(getByLabelText('Saldar')).toBeTruthy();
  });

  it('un accessibilityLabel propio gana', () => {
    const { getByLabelText } = render(
      <ActionButton action={() => {}} label="→" accessibilityLabel="Siguiente" />,
    );
    expect(getByLabelText('Siguiente')).toBeTruthy();
  });

  it('expone su estado deshabilitado a accesibilidad', () => {
    const { getByTestId } = render(
      <ActionButton action={() => {}} label="X" disabled testID="b" />,
    );
    expect(getByTestId('b').props.accessibilityState.disabled).toBe(true);
  });
});

// `plain` se dibuja como texto suelto: sin caja, sin borde, atenuado. Es
// exactamente la variante en la que es fácil que quede de adorno, así que lo
// que se prueba es lo único que la distingue de un `<Text>`.
describe('variante plain', () => {
  it('responde al toque igual que cualquier otro botón', () => {
    const accion = jest.fn();
    const { getByText } = render(
      <ActionButton action={accion} label="MAX" variant="plain" size="sm" />,
    );
    fireEvent.press(getByText('MAX'));
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado no dispara', () => {
    const accion = jest.fn();
    const { getByTestId } = render(
      <ActionButton action={accion} label="MAX" variant="plain" size="sm" disabled testID="max" />,
    );
    fireEvent.press(getByTestId('max'));
    expect(accion).not.toHaveBeenCalled();
  });

  it('sigue siendo un botón para el lector de pantalla', () => {
    const { getByTestId } = render(
      <ActionButton
        action={() => {}} label="MAX" variant="plain" size="sm"
        testID="max" accessibilityLabel="Poner toda la deuda"
      />,
    );
    expect(getByTestId('max').props.accessibilityRole).toBe('button');
    expect(getByTestId('max').props.accessibilityLabel).toBe('Poner toda la deuda');
  });
});

describe('ButtonRack', () => {
  it('renderiza los botones que le pasan', () => {
    const { getByText } = render(
      <ButtonRack>
        <ActionButton action={() => {}} label="Uno" />
        <ActionButton action={() => {}} label="Dos" />
      </ButtonRack>,
    );
    expect(getByText('Uno')).toBeTruthy();
    expect(getByText('Dos')).toBeTruthy();
  });

  it('cada boton conserva su propia accion', () => {
    const a = jest.fn(); const b = jest.fn();
    const { getByText } = render(
      <ButtonRack direction="row">
        <ActionButton action={a} label="Uno" />
        <ActionButton action={b} label="Dos" />
      </ButtonRack>,
    );
    fireEvent.press(getByText('Dos'));
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });
});
