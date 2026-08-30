import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { UnconvertedNotice } from '../UnconvertedNotice';
import type { Bucket } from '@/src/services/fxTotals';

const pendientes: Bucket[] = [
  { currency: 'BRL', minor: 51_643 },
  { currency: 'PYG', minor: 250_000 },
];

describe('UnconvertedNotice', () => {
  it('lista cada moneda que quedo sin convertir', () => {
    const { getByTestId } = render(
      <UnconvertedNotice visible display="ARS" unconverted={pendientes} onClose={() => {}} />,
    );
    expect(getByTestId('unconverted-BRL')).toBeTruthy();
    expect(getByTestId('unconverted-PYG')).toBeTruthy();
  });

  it('muestra cada monto en SU moneda, con sus decimales', () => {
    // PYG no tiene decimales: 250000 en menor unidad son 250.000 guaranies,
    // no 2.500,00. Convertirlos seria inventar el dato que justamente falta.
    const { getByText } = render(
      <UnconvertedNotice visible display="ARS" unconverted={pendientes} onClose={() => {}} />,
    );
    expect(getByText('₲250.000')).toBeTruthy();
    expect(getByText('R$516,43')).toBeTruthy();
  });

  it('sin nada pendiente no se renderiza: el total ya es completo', () => {
    const { toJSON } = render(
      <UnconvertedNotice visible display="ARS" unconverted={[]} onClose={() => {}} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('el boton cierra', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <UnconvertedNotice visible display="ARS" unconverted={pendientes} onClose={onClose} />,
    );
    fireEvent.press(getByText('fx.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
