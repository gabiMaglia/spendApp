import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import type { Group, User, Expense } from '@/src/types/models';

/**
 * T-103.D — el PO: la sección "¿cómo se divide?" de un gasto de grupo tenía
 * un selector con el estilo viejo (pill redondeada) apilado debajo de otro.
 * Los dos ahora son `Segmented variant="tabs"`, la misma "T invertida" que
 * el resto de la app. Este test confirma que la pantalla los sigue mostrando
 * y que cambiar de modo sigue funcionando — no sólo que el código diga
 * `variant="tabs"` (eso ya lo cubre `pestanasUnificadas.test.ts`).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockSearchParams: Record<string, string | undefined> = { groupId: 'g1' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  mockSearchParams = { groupId: 'g1' };
  useAuthStore.setState({ currentUser: ANA, isPro: false });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
});

describe('T-103.D — selectores de "¿cómo se divide?" en un gasto de grupo', () => {
  it('muestra el selector de modo de reparto (Iguales / Porcentaje)', () => {
    const { getByText } = render(<NewExpenseScreen />);
    expect(getByText('expense.split_mode_equal')).toBeTruthy();
    expect(getByText('expense.split_mode_percentage')).toBeTruthy();
  });

  it('al elegir Porcentaje aparece el sub-selector (mismo % / personalizado)', () => {
    const { getByText, queryByText } = render(<NewExpenseScreen />);
    expect(queryByText('expense.percent_same')).toBeNull();

    fireEvent.press(getByText('expense.split_mode_percentage'));

    expect(getByText('expense.percent_same')).toBeTruthy();
    expect(getByText('expense.percent_custom')).toBeTruthy();
  });

  it('volver a Iguales oculta el sub-selector de porcentaje', () => {
    const { getByText, queryByText } = render(<NewExpenseScreen />);
    fireEvent.press(getByText('expense.split_mode_percentage'));
    expect(getByText('expense.percent_same')).toBeTruthy();

    fireEvent.press(getByText('expense.split_mode_equal'));
    expect(queryByText('expense.percent_same')).toBeNull();
  });

  it('modo edición de un gasto de grupo muestra los mismos selectores', () => {
    mockSearchParams = { expenseId: 'e1' };
    const gasto: Expense = {
      id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal',
      splits: [{ userId: 'ana', amount: 10000, isPaid: true }, { userId: 'beto', amount: 10000, isPaid: false }],
      category: 'food', date: 0, createdAt: 0, createdById: 'ana',
      deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as Expense;
    useExpenseStore.setState({ expenses: [gasto] });

    const { getByText } = render(<NewExpenseScreen />);
    expect(getByText('expense.split_mode_equal')).toBeTruthy();
    expect(getByText('expense.split_mode_percentage')).toBeTruthy();
  });
});
