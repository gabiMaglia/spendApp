import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import { migratePersonalBudgetAmount, migratePersonalEntryAmounts } from './moneyMigration';
import type { PersonalEntry, PersonalBudget } from '@/src/types/models';

const storage = createSecureStorage('personal');
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
  mergeEntries:           (incoming: PersonalEntry[]) => void;
  hydrate:                () => void;
}

function persistEntries(entries: PersonalEntry[]) {
  writeScoped(storage, ENTRIES_KEY, JSON.stringify(entries));
}
function persistBudget(budget: PersonalBudget) {
  writeScoped(storage, BUDGET_KEY, JSON.stringify(budget));
}
function persistLastSeen(month: string) {
  writeScoped(storage, LAST_SEEN_KEY, month);
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

  // LWW merge por updatedAt (para import de backup / sync). Mismo patrón que
  // expenseStore.mergeExpenses: gana el registro con mayor updatedAt.
  mergeEntries: (incoming) => {
    const merged = mergeByIdLWW(get().entries, incoming);
    persistEntries(merged);
    set({ entries: merged });
  },

  hydrate: () => {
    const rawEntries  = readScoped(storage, ENTRIES_KEY);
    const rawBudget   = readScoped(storage, BUDGET_KEY);
    const rawLastSeen = readScoped(storage, LAST_SEEN_KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let entries: PersonalEntry[] = [];
    let budget: PersonalBudget = DEFAULT_BUDGET;
    try {
      entries = rawEntries ? (JSON.parse(rawEntries) as PersonalEntry[]) : [];
    } catch { entries = []; }
    try {
      budget = rawBudget ? (JSON.parse(rawBudget) as PersonalBudget) : DEFAULT_BUDGET;
    } catch { budget = DEFAULT_BUDGET; }
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
