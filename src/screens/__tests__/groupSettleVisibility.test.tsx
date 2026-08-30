import React from 'react';
import { render } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * "Saldar deuda" solo aparece si el grupo tiene al menos un gasto (PO
 * 2026-08-30). Sin gastos no hay deuda posible, y el boton mandaba a una
 * pantalla que no podia hacer nada.
 */
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 100_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 50_000 }, { userId: 'beto', amount: 50_000 }],
  splitMode: 'equal', category: 'transport', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'ana', name: 'Ana' } as User });
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
});

describe('visibilidad de "saldar deuda"', () => {
  it('sin gastos NO se ofrece', () => {
    useExpenseStore.setState({ expenses: [] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('con al menos un gasto SI se ofrece', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('settle-debts')).toBeTruthy();
  });

  it('un grupo cuyo unico gasto se borro vuelve a estar vacio', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('un gasto de OTRO grupo no habilita el boton', () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e9', groupId: 'g-otro' })] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('agregar gasto se ofrece SIEMPRE: es como se sale del grupo vacio', () => {
    useExpenseStore.setState({ expenses: [] });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('add-expense')).toBeTruthy();
  });
});
