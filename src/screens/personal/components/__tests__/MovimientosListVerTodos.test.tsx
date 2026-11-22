import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { MovimientosList } from '../MovimientosList';
import type { PersonalEntry } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const entries = (n: number): PersonalEntry[] => Array.from({ length: n }, (_, i) => ({
  id: `e${i}`, kind: 'expense', description: `Mov ${i}`, amount: 100, currency: 'ARS',
  category: 'food', date: Date.now() - i, createdAt: 0, updatedAt: 1, isDeleted: false,
} as PersonalEntry));

const montar = (n: number, onVerTodos = jest.fn()) =>
  render(<MovimientosList entries={entries(n)} monthLabelText="nov" onRemove={jest.fn()} limite={6} onVerTodos={onVerTodos} />);

describe('MovimientosList con límite (T-277)', () => {
  it.each([1, 6])('con %s no hay «Ver todos»', n => {
    const { queryByText } = montar(n);
    expect(queryByText(/personal\.see_all/)).toBeNull();
  });

  it('con 0 sigue el estado vacío', () => {
    const { getByText, queryByText } = montar(0);
    expect(getByText(/personal\.no_movements/)).toBeTruthy();
    expect(queryByText(/personal\.see_all/)).toBeNull();
  });

  it('con 10 pinta 6 filas y «Ver todos (10)», que dispara onVerTodos', () => {
    const onVerTodos = jest.fn();
    const { queryByText, getByText } = montar(10, onVerTodos);
    expect(getByText('Mov 5')).toBeTruthy();
    expect(queryByText('Mov 6')).toBeNull();
    fireEvent.press(getByText(/personal\.see_all/));
    expect(onVerTodos).toHaveBeenCalledTimes(1);
  });

  it('sin `limite` pinta todos y nunca «Ver todos»', () => {
    const { getByText, queryByText } = render(
      <MovimientosList entries={entries(10)} monthLabelText="nov" onRemove={jest.fn()} />);
    expect(getByText('Mov 9')).toBeTruthy();
    expect(queryByText(/personal\.see_all/)).toBeNull();
  });
});
