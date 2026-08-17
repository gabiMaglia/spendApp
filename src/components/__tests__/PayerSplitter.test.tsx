import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PayerSplitter } from '../PayerSplitter';
import type { Payer } from '@/src/types/models';

const members = [{ id: 'ua', name: 'Ana' }, { id: 'ub', name: 'Bob' }];

function setup(value: Payer[], totalAmount = 10000) {
  const onChange = jest.fn();
  const utils = render(
    <PayerSplitter
      members={members}
      value={value}
      totalAmount={totalAmount}
      currency="ARS"
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

describe('PayerSplitter', () => {
  it('muestra un campo por miembro', () => {
    const { getAllByLabelText, getByText } = setup([]);
    expect(getAllByLabelText(/payers\.amount_for/)).toHaveLength(members.length);
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
  });

  it('avisa cuando la suma cuadra con el total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 4000 },
    ]);
    expect(getByText('payers.balanced')).toBeTruthy();
  });

  it('avisa cuánto falta cuando no llega al total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 3000 },
    ]);
    expect(getByText(/payers\.missing/)).toBeTruthy();
  });

  it('avisa cuando se pasan del total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 9000 }, { userId: 'ub', amount: 3000 },
    ]);
    expect(getByText(/payers\.over/)).toBeTruthy();
  });

  it('convierte lo que se escribe a menor unidad', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '62.50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 6250 }]),
    );
  });

  it('acepta coma como separador decimal', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '62,50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 6250 }]),
    );
  });

  it('un texto inválido cuenta como 0, no como NaN', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, 'abc');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 0 }]),
    );
  });

  it('no deja montos negativos', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '-50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 0 }]),
    );
  });

  it('conserva lo cargado de los demás al editar uno', () => {
    const { getAllByLabelText, onChange } = setup([
      { userId: 'ua', amount: 1000 }, { userId: 'ub', amount: 4000 },
    ]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '60');

    expect(onChange).toHaveBeenCalledWith([
      { userId: 'ua', amount: 6000 },
      { userId: 'ub', amount: 4000 },
    ]);
  });
});
