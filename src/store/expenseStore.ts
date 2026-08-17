import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import { migrateExpenseAmounts } from './moneyMigration';
import type { Expense } from '@/src/types/models';

const storage = createSecureStorage('expenses');
const KEY = 'data_v1';
// Guard de idempotencia de la conversión float→entero de montos (ADR-002 §6).
// Correrla dos veces multiplicaría los montos otra vez por el factor.
const MONEY_MIGRATION_KEY = 'money_int_v1_done';

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
  writeScoped(storage, KEY, JSON.stringify(expenses));
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
    const merged = mergeByIdLWW(get().expenses, incoming);
    persist(merged);
    set({ expenses: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let expenses: Expense[] = [];
    try {
      expenses = raw ? (JSON.parse(raw) as Expense[]) : [];
    } catch {
      expenses = [];
    }

    // Conversión one-shot de datos existentes (float → entero, ADR-002 §6).
    // Debe correr ANTES de la migración WatermelonDB (T-003).
    if (!storage.getBoolean(MONEY_MIGRATION_KEY)) {
      expenses = migrateExpenseAmounts(expenses);
      persist(expenses);
      storage.set(MONEY_MIGRATION_KEY, true);
    }

    set({ expenses, isLoading: false });
  },
}));
