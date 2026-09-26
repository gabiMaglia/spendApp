import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLevels } from './mergeLevels';
import { siguienteUpdatedAt } from './relojDelMerge';
import { signOnCreate, signOnEdit } from '@/src/sync/signOnWrite';
import type { RecurringExpense } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';
import { recordError } from '@/src/services/errorLog';

const storage = createSecureStorage('recurring');
const KEY = 'data_v1';

interface RecurringStoreState {
  recurring: RecurringExpense[];
  isLoading: boolean;
  getById: (id: string) => RecurringExpense | undefined;
  /** Plantillas vivas: ni borradas ni pausadas. */
  active: () => RecurringExpense[];
  addRecurring: (r: RecurringExpense) => void;
  /** `false` = la edición NO se guardó (T-152 · D2). Ver `expenseStore.updateExpense`. */
  updateRecurring: (id: string, patch: Partial<RecurringExpense>) => boolean;
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
    const actual = get().recurring.find(r => r.id === id);
    if (!actual) return true;

    const ahora = syncedNow();
    const firmado = signOnEdit('recurring', actual, {
      ...actual, ...patch, updatedAt: siguienteUpdatedAt(actual.updatedAt, ahora),
    });
    if (firmado === null) {
      recordError({
        message: 'signOnEdit bloqueado: no se pudo re-firmar una edición propia de una recurrente ya firmada',
        fatal: false,
      });
      return false;
    }

    const recurring = get().recurring.map(r => (r.id === id ? firmado : r));
    persist(recurring);
    set({ recurring });
    return true;
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
