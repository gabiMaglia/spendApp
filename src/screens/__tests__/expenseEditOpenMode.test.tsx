import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-185: cualquier miembro ve (y puede tocar) el botón de editar en el gasto
 * de otro — igual que Splitwise. T-186 sacó el modo «con acuerdo»: ya no hay
 * excepción para `consensus` (era U2, se borró con el modo).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ id: 'e1' }),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 20_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 10_000 }, { userId: 'beto', amount: 10_000 }],
  category: 'food', date: 0, createdAt: 0,
  createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Group);

beforeEach(() => {
  mockPush.mockClear();
  useAuthStore.setState({ currentUser: BETO });
  useUserStore.setState({ users: [ANA, BETO] });
  useCommentStore.setState({ comments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('U1 · cualquier miembro ve y usa el botón de editar', () => {
  it('Beto ve el lápiz en el gasto de Ana y abre expense/new con el id', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const { getByTestId } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByTestId('edit-expense-btn'));

    expect(mockPush).toHaveBeenCalledWith('/expense/new?expenseId=e1');
  });
});

describe('U3 · gasto editado por otro: se muestra quién', () => {
  it('"Editado por Beto" cuando editedById difiere del creador', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto({ editedById: 'beto' })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    expect(getByText(/expense\.edited_by/)).toBeTruthy();
  });

  it('no se muestra nada cuando nadie más editó', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const { queryByText } = render(<ExpenseDetailScreen />);
    expect(queryByText(/expense\.edited_by/)).toBeNull();
  });
});
