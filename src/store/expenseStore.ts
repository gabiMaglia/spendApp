import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import type { Expense } from '@/src/types/models';

const storage = createStorage('expenses');
const KEY = 'data_v1';

interface ExpenseStoreState {
  expenses: Expense[];
  isLoading: boolean;
  getByGroupId: (groupId: string) => Expense[];
  addExpense: (expense: Expense) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  mergeExpenses: (incoming: Expense[]) => void;
  hydrate: () => void;
}

function persist(expenses: Expense[]) {
  storage.set(KEY, JSON.stringify(expenses));
}

export const useExpenseStore = create<ExpenseStoreState>((set, get) => ({
  expenses: [],
  isLoading: true,

  getByGroupId: (groupId) =>
    get().expenses.filter(e => e.groupId === groupId && !e.isDeleted),

  addExpense: (expense) => {
    const expenses = [...get().expenses, expense];
    persist(expenses);
    set({ expenses });
  },

  updateExpense: (id, patch) => {
    const expenses = get().expenses.map(e =>
      e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e,
    );
    persist(expenses);
    set({ expenses });
  },

  // LWW merge para sync P2P
  mergeExpenses: (incoming) => {
    const current = get().expenses;
    const merged = [...current];
    for (const inc of incoming) {
      const idx = merged.findIndex(e => e.id === inc.id);
      if (idx === -1) {
        merged.push(inc);
      } else if (inc.updatedAt > merged[idx].updatedAt) {
        merged[idx] = inc;
      }
    }
    persist(merged);
    set({ expenses: merged });
  },

  hydrate: () => {
    const raw = storage.getString(KEY);
    const expenses = raw ? (JSON.parse(raw) as Expense[]) : [];
    set({ expenses, isLoading: false });
  },
}));
