import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore } from '@/src/store/personalStore';
import type { User, Group, Expense } from '@/src/types/models';

/**
 * T-152 · D2 (decisión del PO 2026-09-26): si el núcleo de un gasto ya
 * firmado no se puede re-firmar al editarlo, `updateExpense` ahora BLOQUEA la
 * edición (devuelve `false`, no toca el store) en vez de guardarla sin firma
 * — guardarla la perdía en silencio contra la próxima republicación de la
 * versión vieja firmada (verificador: 20000 vuelve a 10000).
 *
 * Esto verifica el lado de la PANTALLA: el aviso se muestra y la pantalla NO
 * se comporta como si hubiera guardado (no navega hacia atrás, no toca la
 * réplica personal).
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const mockRouterBack = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

const USER = { id: 'ua', name: 'Ana' } as User;
const GROUP: Group = {
  id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
  createdAt: 0, createdById: 'ua', deletionVotes: [], updatedAt: 0, isDeleted: false,
};
const EXPENSE: Expense = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ua', createdById: 'ua',
  splits: [
    { userId: 'ua', amount: 5_000, isPaid: true },
    { userId: 'ub', amount: 5_000, isPaid: false },
  ],
  splitMode: 'equal', category: 'food', date: 1_000, createdAt: 1_000,
  updatedAt: 1_000, isDeleted: false, deletionVotes: [],
};

describe('T-152 · D2 — edición bloqueada por firma avisa y no cierra la pantalla', () => {
  beforeEach(() => {
    mockSearchParams = { expenseId: 'e1' };
    mockRouterBack.mockReset();
    useAuthStore.setState({ currentUser: USER, isPro: false });
    useGroupStore.setState({ groups: [GROUP] });
    useExpenseStore.setState({ expenses: [EXPENSE] });
    usePersonalStore.setState({ entries: [] });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('si updateExpense bloquea (firma falló), avisa y NO navega hacia atrás', () => {
    const updateExpense = jest.fn(() => false);
    useExpenseStore.setState({ updateExpense });
    const { getByText } = render(<NewExpenseScreen />);

    fireEvent.press(getByText('expense.save'));

    expect(updateExpense).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('sync.sign_failed_title', 'sync.sign_failed_body');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('si updateExpense guarda (firma OK), no avisa y sí navega hacia atrás', () => {
    const updateExpense = jest.fn(() => true);
    useExpenseStore.setState({ updateExpense });
    const { getByText } = render(<NewExpenseScreen />);

    fireEvent.press(getByText('expense.save'));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockRouterBack).toHaveBeenCalled();
  });
});
