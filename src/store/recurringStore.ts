import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import type { RecurringExpense } from '@/src/types/models';

const storage = createSecureStorage('recurring');
const KEY = 'data_v1';

interface RecurringStoreState {
  recurring: RecurringExpense[];
  isLoading: boolean;
  getById: (id: string) => RecurringExpense | undefined;
  /** Plantillas vivas: ni borradas ni pausadas. */
  active: () => RecurringExpense[];
  addRecurring: (r: RecurringExpense) => void;
  updateRecurring: (id: string, patch: Partial<RecurringExpense>) => void;
  removeRecurring: (id: string) => void;
  mergeRecurring: (incoming: RecurringExpense[]) => void;
  hydrate: () => void;
}

function persist(recurring: RecurringExpense[]) {
  writeScoped(storage, KEY, JSON.stringify(recurring));
}

export const useRecurringStore = create<RecurringStoreState>((set, get) => ({
  recurring: [],
  isLoading: true,

  getById: (id) => get().recurring.find(r => r.id === id),

  active: () => get().recurring.filter(r => !r.isDeleted && r.isActive),

  addRecurring: (r) => {
    const recurring = [...get().recurring, r];
    persist(recurring);
    set({ recurring });
  },

  updateRecurring: (id, patch) => {
    const recurring = get().recurring.map(r =>
      r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // Tombstone, nunca DELETE físico (regla de negocio #1).
  removeRecurring: (id) => {
    const recurring = get().recurring.map(r =>
      r.id === id ? { ...r, isDeleted: true, updatedAt: Date.now() } : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // LWW por updatedAt, igual que el resto de los stores (sync P2P).
  mergeRecurring: (incoming) => {
    const merged = [...get().recurring];
    for (const inc of incoming) {
      const i = merged.findIndex(r => r.id === inc.id);
      if (i === -1) merged.push(inc);
      else if (inc.updatedAt > merged[i]!.updatedAt) merged[i] = inc;
    }
    persist(merged);
    set({ recurring: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    let recurring: RecurringExpense[] = [];
    try {
      recurring = raw ? (JSON.parse(raw) as RecurringExpense[]) : [];
    } catch {
      recurring = []; // dato corrupto: se arranca vacío en vez de tirar
    }
    set({ recurring, isLoading: false });
  },
}));
