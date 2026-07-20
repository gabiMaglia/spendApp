import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import { migratePersonalBudgetAmount, migratePersonalEntryAmounts } from './moneyMigration';
import type { PersonalEntry, PersonalBudget } from '@/src/types/models';

const storage = createStorage('personal');
const ENTRIES_KEY   = 'entries_v1';
const BUDGET_KEY    = 'budget_v1';
const LAST_SEEN_KEY = 'lastSeen_v1';
// Guard de idempotencia de la conversión float→entero de montos (ADR-002 §6).
// Cubre tanto `entries[].amount` como `budget.monthlyAmount`.
const MONEY_MIGRATION_KEY = 'money_int_v1_done';

const DEFAULT_BUDGET: PersonalBudget = {
  currency:        'ARS',
  monthlyAmount:   0,
  includeOwedToMe: false,
};

interface PersonalStoreState {
  entries:        PersonalEntry[];
  budget:         PersonalBudget;
  lastSeenMonth:  string;
  addEntry:               (entry: PersonalEntry) => void;
  removeEntry:            (id: string) => void;
  updateReplicatedEntry:  (sourceGroupExpenseId: string, patch: Partial<PersonalEntry>) => void;
  setBudget:              (budget: PersonalBudget) => void;
  setLastSeenMonth:       (month: string) => void;
  hydrate:                () => void;
}

function persistEntries(entries: PersonalEntry[]) {
  storage.set(ENTRIES_KEY, JSON.stringify(entries));
}
function persistBudget(budget: PersonalBudget) {
  storage.set(BUDGET_KEY, JSON.stringify(budget));
}
function persistLastSeen(month: string) {
  storage.set(LAST_SEEN_KEY, month);
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
  entries:       [],
  budget:        DEFAULT_BUDGET,
  lastSeenMonth: currentMonthKey(),

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

  setLastSeenMonth: (month) => {
    persistLastSeen(month);
    set({ lastSeenMonth: month });
  },

  hydrate: () => {
    const rawEntries  = storage.getString(ENTRIES_KEY);
    const rawBudget   = storage.getString(BUDGET_KEY);
    const rawLastSeen = storage.getString(LAST_SEEN_KEY);
    let entries      = rawEntries  ? (JSON.parse(rawEntries)  as PersonalEntry[]) : [];
    let budget       = rawBudget   ? (JSON.parse(rawBudget)   as PersonalBudget)  : DEFAULT_BUDGET;
    const lastSeenMonth = rawLastSeen ?? currentMonthKey();

    // Conversión one-shot de datos existentes (float → entero, ADR-002 §6).
    // Solo persiste lo que ya existía en storage — no crea un budget_v1
    // nuevo en una instalación limpia que nunca configuró presupuesto.
    if (!storage.getBoolean(MONEY_MIGRATION_KEY)) {
      if (rawEntries) {
        entries = migratePersonalEntryAmounts(entries);
        persistEntries(entries);
      }
      if (rawBudget) {
        budget = migratePersonalBudgetAmount(budget);
        persistBudget(budget);
      }
      storage.set(MONEY_MIGRATION_KEY, true);
    }

    set({ entries, budget, lastSeenMonth });
  },
}));
