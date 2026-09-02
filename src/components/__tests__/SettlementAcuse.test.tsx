import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SettlementAcuse } from '../SettlementAcuse';

const props = {
  estado: 'pendiente' as const,
  meToca: false,
  nombreDeQuienCobra: 'Beto',
  onConfirmar: jest.fn(),
  onRechazar: jest.fn(),
  testID: 'acuse',
};

beforeEach(() => jest.clearAllMocks());

describe('qué se muestra según quién mira', () => {
  // El caso normal no merece ruido: un saldado confirmado se ve como siempre.
  it('un saldado efectivo no dibuja nada', () => {
    const { queryByTestId } = render(<SettlementAcuse {...props} estado="efectivo" meToca={false} />);
    expect(queryByTestId('acuse-esperando')).toBeNull();
    expect(queryByTestId('acuse-decidir')).toBeNull();
    expect(queryByTestId('acuse-rechazado')).toBeNull();
  });

  it('a quien le toca decidir le muestra las dos acciones', () => {
    const { getByTestId } = render(<SettlementAcuse {...props} meToca />);
    expect(getByTestId('acuse-confirmar')).toBeTruthy();
    expect(getByTestId('acuse-rechazar')).toBeTruthy();
  });

  /**
   * Sin esto, quien pagó ve su deuda en cero y no sabe que el otro todavía no
   * la dio por recibida — que es exactamente lo que D1 no quiere ocultar.
   */
  it('a los demás les dice a quién se está esperando', () => {
    const { getByTestId, queryByTestId } = render(<SettlementAcuse {...props} />);
    expect(getByTestId('acuse-esperando')).toBeTruthy();
    expect(queryByTestId('acuse-confirmar')).toBeNull();
  });

  it('un rechazo se cuenta para los dos lados', () => {
    const { getByTestId, queryByTestId } = render(
      <SettlementAcuse {...props} estado="rechazado" meToca={false} />,
    );
    expect(getByTestId('acuse-rechazado')).toBeTruthy();
    // Ya decidió: no se le vuelve a preguntar desde acá.
    expect(queryByTestId('acuse-confirmar')).toBeNull();
  });

  it('nombra a quien cobra, para que se sepa a quién se espera', () => {
    const { getByText } = render(<SettlementAcuse {...props} />);
    expect(getByText(/Beto/)).toBeTruthy();
  });
});

describe('las acciones', () => {
  it('confirmar avisa una sola vez', () => {
    const { getByTestId } = render(<SettlementAcuse {...props} meToca />);
    fireEvent.press(getByTestId('acuse-confirmar'));
    expect(props.onConfirmar).toHaveBeenCalledTimes(1);
    expect(props.onRechazar).not.toHaveBeenCalled();
  });

  it('rechazar no confirma de paso', () => {
    const { getByTestId } = render(<SettlementAcuse {...props} meToca />);
    fireEvent.press(getByTestId('acuse-rechazar'));
    expect(props.onRechazar).toHaveBeenCalledTimes(1);
    expect(props.onConfirmar).not.toHaveBeenCalled();
  });
});
