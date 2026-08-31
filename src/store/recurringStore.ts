import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLevels } from './mergeLevels';
import { signOnCreate, signOnEdit } from '@/src/sync/signOnWrite';
import type { RecurringExpense } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

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
    const recurring = [...get().recurring, signOnCreate('recurring', r)];
    persist(recurring);
    set({ recurring });
  },

  updateRecurring: (id, patch) => {
    const recurring = get().recurring.map(r =>
      r.id === id
        ? signOnEdit('recurring', r, { ...r, ...patch, updatedAt: syncedNow() })
        : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // Tombstone, nunca DELETE físico (regla de negocio #1).
  removeRecurring: (id) => {
    const recurring = get().recurring.map(r =>
      r.id === id ? { ...r, isDeleted: true, updatedAt: syncedNow() } : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // LWW por updatedAt, igual que el resto de los stores (sync P2P).
  mergeRecurring: (incoming) => {
    const merged = mergeByIdLevels('recurring', get().recurring, incoming);
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
