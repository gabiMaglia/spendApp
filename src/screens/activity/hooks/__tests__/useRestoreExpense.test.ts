import { renderHook } from '@testing-library/react-native';
import { useRestoreExpense } from '../useRestoreExpense';
import { useExpenseStore } from '@/src/store/expenseStore';
import type { Expense, User } from '@/src/types/models';

/**
 * T-186 · Task 0: restaurar deja quién restauró (`restoredById`), campo del
 * «resto» sin firma — coexiste todavía con el voto `restore`.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal',
  splits: [{ userId: 'ua', amount: 10000, isPaid: false }],
  category: 'food', date: 0, createdAt: 0,
  createdById: 'ub', updatedAt: 0, isDeleted: true, ...over,
} as Expense);

const user = (id: string): User => ({ id, name: id } as User);

it('al restaurar, queda restoredById = quien restauró', () => {
  useExpenseStore.setState({ expenses: [gasto()] });

  const { result } = renderHook(() => useRestoreExpense(user('ua')));
  result.current('e1');

  const g = useExpenseStore.getState().expenses[0]!;
  expect(g.isDeleted).toBe(false);
  expect(g.restoredById).toBe('ua');
});
