import React from 'react';
import { render } from '@testing-library/react-native';

import MovimientosMesScreen from '../MovimientosMesScreen';
import { usePersonalStore } from '@/src/store/personalStore';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mk = (i: number, date: number) => ({
  id: `e${i}`, kind: 'expense', description: `Mov ${i}`, amount: 100, currency: 'ARS',
  category: 'food', date, createdAt: 0, updatedAt: 1, isDeleted: false,
});

beforeEach(() => {
  const d = new Date(); d.setDate(15);
  const cerrado = new Date(d.getFullYear(), d.getMonth() - 1, 15, 12).getTime();
  const actual = new Date(d.getFullYear(), d.getMonth(), 15, 12).getTime();
  usePersonalStore.setState({
    entries: [
      ...Array.from({ length: 8 }, (_, i) => mk(i, cerrado - i)),
      mk(99, actual),
    ] as never,
  });
  const m = new Date(cerrado);
  mockParams = { month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}` };
});

describe('pantalla «Ver todos» (T-277)', () => {
  it('lista los 8 del mes pedido (sin tope) y ninguno de otro mes', () => {
    const { getByText, queryByText } = render(<MovimientosMesScreen />);
    for (let i = 0; i < 8; i++) expect(getByText(`Mov ${i}`)).toBeTruthy();
    expect(queryByText('Mov 99')).toBeNull();
    expect(queryByText(/personal\.see_all/)).toBeNull();
  });
});
