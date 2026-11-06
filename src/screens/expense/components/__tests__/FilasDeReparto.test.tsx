import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { FilasDeReparto } from '@/src/screens/expense/components/FilasDeReparto';
import type { SplitCalculado } from '@/src/screens/expense/repartoDeGasto';

const splits: SplitCalculado[] = [
  { userId: 'yo',  amount: 600, percent: 60, isLast: false },
  { userId: 'ana', amount: 400, percent: 40, isLast: true },
];

const filas = (over: Partial<React.ComponentProps<typeof FilasDeReparto>> = {}) => (
  <FilasDeReparto
    splits={splits}
    splitMode="percentage"
    percentSub="custom"
    samePercent=""
    customPercents={['60']}
    onCustomPercentsChange={jest.fn()}
    lastPercent={40}
    percentError={false}
    currency="ARS"
    {...over}
  />
);

describe('FilasDeReparto — «Por persona»', () => {
  it('cada fila menos la del resto tiene su campo de %', () => {
    const r = render(filas());
    expect(r.getByTestId('percent-input-yo')).toBeTruthy();
    expect(r.queryByTestId('percent-input-ana')).toBeNull();
  });

  it('el campo es lo ÚLTIMO de la fila, después del monto', () => {
    const r = render(filas());
    const fila = r.getByTestId('percent-input-yo').parent!;
    const hijos = fila.children as unknown as { props: { testID?: string } }[];
    expect(hijos[hijos.length - 1].props.testID).toBe('percent-input-yo');
  });

  it('tipear actualiza el % de esa persona', () => {
    const onChange = jest.fn();
    const r = render(filas({ customPercents: [''], onCustomPercentsChange: onChange }));
    fireEvent.changeText(r.getByPlaceholderText('0'), '70');
    expect(onChange).toHaveBeenCalledWith(['70']);
  });

  it('en «Todos igual» no hay campos por fila', () => {
    const r = render(filas({ percentSub: 'same', samePercent: '60' }));
    expect(r.queryByTestId('percent-input-yo')).toBeNull();
  });
});
