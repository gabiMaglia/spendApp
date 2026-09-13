import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupStore } from '@/src/store/groupStore';
import type { User } from '@/src/types/models';

/**
 * T-103.A — el PO sacó las categorías de los ingresos: "son absurdas". Todo
 * ingreso se guarda con la categoría "otros" (clave real `other`, la misma
 * que ya usan los gastos) hasta que exista una iteración con categorías de
 * ingreso de verdad. El gasto no cambia: sigue mostrando su selector.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

function llenarYGuardar(getByPlaceholderText: any, getByText: any, descPlaceholder: string) {
  fireEvent.changeText(getByPlaceholderText(descPlaceholder), 'Algo');
  fireEvent.changeText(getByPlaceholderText('0'), '100');
  fireEvent.press(getByText('expense.save'));
}

beforeEach(() => {
  mockSearchParams = {};
  useAuthStore.setState({ currentUser: { id: 'ua', name: 'Ana' } as User, isPro: false });
  useGroupStore.setState({ groups: [] });
  usePersonalStore.setState({ entries: [] });
});

describe('T-103.A — ingresos sin categoría', () => {
  it('en modo Ingreso NO muestra el selector de categorías', () => {
    mockSearchParams = { allowIncome: '1', kind: 'income' };
    const { queryByText } = render(<NewExpenseScreen />);

    // Ninguna pastilla de categoría (ni las de gasto ni las viejas de ingreso)
    // debe estar presente cuando se está cargando un ingreso.
    expect(queryByText('categories.food')).toBeNull();
    expect(queryByText('categories.salary')).toBeNull();
    expect(queryByText('categories.freelance')).toBeNull();
  });

  it('en modo Gasto SÍ muestra el selector de categorías', () => {
    mockSearchParams = { allowIncome: '1' };
    const { getByText } = render(<NewExpenseScreen />);

    expect(getByText('categories.food')).toBeTruthy();
  });

  it('un ingreso se guarda con categoría "otros" (clave other)', () => {
    mockSearchParams = { allowIncome: '1', kind: 'income' };
    const addEntry = jest.fn();
    usePersonalStore.setState({ addEntry });
    const { getByPlaceholderText, getByText } = render(<NewExpenseScreen />);

    llenarYGuardar(getByPlaceholderText, getByText, 'expense.income_desc_placeholder');

    expect(addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'income', category: 'other' }),
    );
  });

  it('elegir una categoría en Gasto y cambiar a Ingreso guarda "otros"', () => {
    mockSearchParams = { allowIncome: '1' };
    const addEntry = jest.fn();
    usePersonalStore.setState({ addEntry });
    const { getByPlaceholderText, getByText } = render(<NewExpenseScreen />);

    // Elige una categoría de gasto explícita, distinta de "otros".
    fireEvent.press(getByText('categories.food'));
    // Cambia a Ingreso.
    fireEvent.press(getByText('expense.kind_income'));

    llenarYGuardar(getByPlaceholderText, getByText, 'expense.income_desc_placeholder');

    expect(addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'income', category: 'other' }),
    );
  });
});
