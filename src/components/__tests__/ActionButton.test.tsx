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
