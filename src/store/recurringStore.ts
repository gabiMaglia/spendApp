import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLevels } from './mergeLevels';
import { siguienteUpdatedAt } from './relojDelMerge';
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
  mergeRecurring: (incoming: RecurringExpense[], now?: number) => void;
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
    const ahora = syncedNow();
    const recurring = get().recurring.map(r =>
      r.id === id
        ? signOnEdit('recurring', r, { ...r, ...patch, updatedAt: siguienteUpdatedAt(r.updatedAt, ahora) })
        : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // Tombstone, nunca DELETE físico (regla de negocio #1).
  removeRecurring: (id) => {
    const ahora = syncedNow();
    const recurring = get().recurring.map(r =>
      r.id === id ? { ...r, isDeleted: true, updatedAt: siguienteUpdatedAt(r.updatedAt, ahora) } : r,
    );
    persist(recurring);
    set({ recurring });
  },

  // Merge por niveles (T-041 · S7) con tope de reloj (T-144).
  mergeRecurring: (incoming, now = syncedNow()) => {
    const merged = mergeByIdLevels('recurring', get().recurring, incoming, now);
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
