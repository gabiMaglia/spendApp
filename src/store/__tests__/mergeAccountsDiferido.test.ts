import { mergeAccounts } from '../accountLink';
import { useAuthStore } from '../authStore';
import { useExpenseStore } from '../expenseStore';
import { usePersonalStore } from '../personalStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { discardScopedWrites, SCOPED_WRITE_DELAY_MS } from '../userScope';
import type { Expense, PersonalEntry, User } from '@/src/types/models';

const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-nuevo', groupId: '', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: APPLE, splitMode: 'equal', splits: [], memberIds: [APPLE],
  category: 'food', date: 0, createdAt: 0, createdById: APPLE, deletionVotes: [],
  updatedAt: 0, isDeleted: false, ...over,
} as unknown as Expense);

const entrada = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'pe-nueva', kind: 'expense', description: 'Nafta', amount: 500, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 0, isDeleted: false, ...over,
} as unknown as PersonalEntry);

/**
 * T-156 (bloqueante de QA, ronda 2): la fusión de cuentas lee MMKV crudo
 * (`readList`/`storage.getString` en `mergeAccountData.ts` y `accountLink.ts`)
 * SIN vaciar lo que `writeScopedLazy` todavía tiene en el debounce de 300ms.
 * Un `addExpense`/`addEntry` justo antes de un link (QR, deep link o
 * confirmación con directorio — todos corren `mergeAccounts` en el momento)
 * quedaba invisible en la cuenta destino: no estaba en disco todavía y la
 * fusión no lo esperó.
 */
describe('mergeAccounts no pierde una escritura diferida reciente', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ['auth', 'groups', 'expenses', 'payments', 'personal', 'users', 'recurring', 'comments']
      .forEach(b => createSecureStorage(b as any).clearAll());
    useAuthStore.setState({ currentUser: { id: APPLE } as User, isPro: false, isLoading: false });
    useExpenseStore.setState({ expenses: [], isLoading: false });
    usePersonalStore.setState({ entries: [] });
  });

  afterEach(() => {
    discardScopedWrites();
    jest.useRealTimers();
  });

  it('un gasto agregado <300ms antes del link llega a la cuenta destino', () => {
    useExpenseStore.getState().addExpense(gasto());

    // Sin avanzar timers: la escritura sigue en el debounce, no en disco.
    mergeAccounts(APPLE, GOOGLE);

    const raw = createSecureStorage('expenses').getString(`data_v1::u:${GOOGLE}`);
    const ids = raw ? (JSON.parse(raw) as Expense[]).map(e => e.id) : [];
    expect(ids).toContain('e-nuevo');
  });

  it('una entrada personal agregada <300ms antes del link llega a la cuenta destino', () => {
    usePersonalStore.getState().addEntry(entrada());

    mergeAccounts(APPLE, GOOGLE);

    const raw = createSecureStorage('personal').getString(`entries_v1::u:${GOOGLE}`);
    const ids = raw ? (JSON.parse(raw) as PersonalEntry[]).map(e => e.id) : [];
    expect(ids).toContain('pe-nueva');
  });

  it('sigue funcionando si el link ocurre DESPUÉS de que el debounce venció (no rompe el camino normal)', () => {
    useExpenseStore.getState().addExpense(gasto({ id: 'e-viejo' }));
    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);

    mergeAccounts(APPLE, GOOGLE);

    const raw = createSecureStorage('expenses').getString(`data_v1::u:${GOOGLE}`);
    const ids = raw ? (JSON.parse(raw) as Expense[]).map(e => e.id) : [];
    expect(ids).toContain('e-viejo');
  });
});
