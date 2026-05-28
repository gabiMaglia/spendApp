import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import type { PersonalEntry, PersonalBudget } from '@/src/types/models';

const storage = createStorage('personal');
const ENTRIES_KEY = 'entries_v1';
const BUDGET_KEY  = 'budget_v1';

const DEFAULT_BUDGET: PersonalBudget = {
  currency:        'ARS',
  monthlyAmount:   0,
  includeOwedToMe: false,
};

interface PersonalStoreState {
  entries: PersonalEntry[];
  budget:  PersonalBudget;
  addEntry:               (entry: PersonalEntry) => void;
  removeEntry:            (id: string) => void;
  updateReplicatedEntry:  (sourceGroupExpenseId: string, patch: Partial<PersonalEntry>) => void;
  setBudget:              (budget: PersonalBudget) => void;
  hydrate:                () => void;
}

function persistEntries(entries: PersonalEntry[]) {
  storage.set(ENTRIES_KEY, JSON.stringify(entries));
}
function persistBudget(budget: PersonalBudget) {
  storage.set(BUDGET_KEY, JSON.stringify(budget));
}

/** "YYYY-MM" del timestamp dado, en hora local. */
export function toMonthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY-MM" del mes actual. */
export function currentMonthKey(): string {
  return toMonthKey(Date.now());
}

export const usePersonalStore = create<PersonalStoreState>((set, get) => ({
  entries: [],
  budget:  DEFAULT_BUDGET,

  addEntry: (entry) => {
    const entries = [...get().entries, entry];
    persistEntries(entries);
    set({ entries });
  },

  removeEntry: (id) => {
    const entries = get().entries.map(e =>
      e.id === id ? { ...e, isDeleted: true, updatedAt: Date.now() } : e,
    );
    persistEntries(entries);
    set({ entries });
  },

  updateReplicatedEntry: (sourceGroupExpenseId, patch) => {
    const entries = get().entries.map(e =>
      e.sourceGroupExpenseId === sourceGroupExpenseId && !e.isDeleted
        ? { ...e, ...patch, updatedAt: Date.now() }
        : e,
    );
    persistEntries(entries);
    set({ entries });
  },

  setBudget: (budget) => {
    persistBudget(budget);
    set({ budget });
  },

  hydrate: () => {
    const rawEntries = storage.getString(ENTRIES_KEY);
    const rawBudget  = storage.getString(BUDGET_KEY);
    const entries = rawEntries ? (JSON.parse(rawEntries) as PersonalEntry[]) : [];
    const budget  = rawBudget  ? (JSON.parse(rawBudget)  as PersonalBudget)  : DEFAULT_BUDGET;
    set({ entries, budget });
  },
}));
