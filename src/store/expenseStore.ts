import { create } from 'zustand';
import type { Expense } from '@/src/types/models';
import MOCK_EXPENSES from '@/src/mocks/expenses.json';

interface ExpenseStoreState {
  expenses: Expense[];
  getByGroupId: (groupId: string) => Expense[];
  addExpense: (expense: Expense) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
}

export const useExpenseStore = create<ExpenseStoreState>((set, get) => ({
  expenses: MOCK_EXPENSES as Expense[],

  getByGroupId: (groupId) =>
    get().expenses.filter(e => e.groupId === groupId && !e.isDeleted),

  addExpense: (expense) => set(s => ({ expenses: [...s.expenses, expense] })),

  updateExpense: (id, patch) =>
    set(s => ({
      expenses: s.expenses.map(e =>
        e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e,
      ),
    })),
}));
