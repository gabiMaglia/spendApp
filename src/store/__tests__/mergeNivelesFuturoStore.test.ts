import { useExpenseStore } from '../expenseStore';
import { useGroupStore } from '../groupStore';
import { applyDelta, type SyncDelta } from '@/src/sync/useSyncQR';
import { syncedNow } from '@/src/utils/syncedClock';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';
import type { Expense, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));
/**
 * `syncedNow()` se mockea (D2 del verifier, `engram/qa/T-144-verifier.md`):
 * varios casos de abajo necesitan distinguir "el store usó SU default" de "el
 * store usó el `now` que le pasamos", o comparar contra un previo elegido a
 * mano — y con el reloj real no hay forma de hacer eso sin que el test dependa
 * de en qué milisegundo exacto corrió.
 */
jest.mock('@/src/utils/syncedClock', () => ({ syncedNow: jest.fn() }));
const mockedSyncedNow = syncedNow as jest.Mock;

/**
 * T-144 (SEC-02), por los caminos reales: relay y QR comparten `applyDelta`
 * y ninguno pasa `now`, así que el tope depende del default `syncedNow()`
 * fijado en cada store — como `mergeUsersFuturoStore.test.ts` para perfiles.
 */
const NOW = 1_790_000_000_000;

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: 0,
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, ...over,
} as Expense);

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS', deletionMode: 'consensus',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, ...over,
} as Group);

const delta = (parte: Partial<SyncDelta>): SyncDelta => ({
  version: 1, fromUserId: 'mallory', timestamp: NOW,
  groups: [], expenses: [], payments: [], users: [], ...parte,
} as SyncDelta);

beforeEach(() => {
  mockedSyncedNow.mockReturnValue(NOW);
  useExpenseStore.setState({ expenses: [gasto()] });
  useGroupStore.setState({ groups: [grupo()] });
});

it('un tombstone con updatedAt 9e15 que llega por applyDelta no borra el gasto', () => {
  applyDelta(delta({ expenses: [gasto({ isDeleted: true, updatedAt: 9e15 })] }), 'ana');
  expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
});

it('una expulsión con updatedAt 9e15 que llega por applyDelta no saca a nadie', () => {
  applyDelta(delta({ groups: [grupo({ memberIds: ['mallory'], updatedAt: 9e15 })] }), 'ana');
  expect(useGroupStore.getState().groups[0]!.memberIds).toEqual(['ana', 'beto']);
});

/**
 * D2 del verifier: el test viejo pasaba un `now` explícito igual al default
 * (`Date.now()` en ambos lados), así que no podía distinguir si el store
 * usaba el parámetro o su propio default. Acá el reloj "real" del store
 * (el mock) queda MUY atrás, y sólo el `now` explícito hace plausible el
 * `updatedAt` entrante — si el store lo ignorara y usara su default, el
 * segundo test fallaría exactamente igual que el primero.
 */
describe('`now` inyectado explícito manda sobre el default del store', () => {
  it('un `now` explícito que hace plausible un updatedAt que el default rechazaría, gana', () => {
    mockedSyncedNow.mockReturnValue(NOW - 1_000_000); // el reloj del store, muy atrás
    const entranteFuturoParaElDefault = { ...gasto(), isDeleted: true, updatedAt: NOW };
    useExpenseStore.getState().mergeExpenses([entranteFuturoParaElDefault], NOW);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('el mismo delta SIN el `now` explícito usa el default y lo rechaza', () => {
    mockedSyncedNow.mockReturnValue(NOW - 1_000_000);
    const entranteFuturoParaElDefault = { ...gasto(), isDeleted: true, updatedAt: NOW };
    useExpenseStore.getState().mergeExpenses([entranteFuturoParaElDefault]);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });
});

describe('la estampa propia sana lo envenenado y respeta un previo adelantado', () => {
  it('con un previo envenenado (fuera de tolerancia), updateExpense sana a `now`', () => {
    useExpenseStore.setState({ expenses: [gasto({ updatedAt: 9e15 })] });
    useExpenseStore.getState().updateExpense('e1', { description: 'Cena arreglada' });
    expect(useExpenseStore.getState().expenses[0]!.updatedAt).toBe(NOW);
  });

  /**
   * Este es el caso que el test viejo no cubría: un previo DENTRO de la
   * tolerancia (plausible) pero adelantado respecto de `now`. Con el código
   * viejo (`updatedAt: syncedNow()`) esto habría dado `NOW`, un valor MENOR
   * que el previo — perdiendo el LWW contra el propio registro anterior. La
   * estampa correcta es `previo + 1`, nunca `now` a secas.
   */
  it('con un previo adelantado pero plausible, updateExpense da previo+1, no `now`', () => {
    const previo = NOW + TOLERANCIA_RELOJ_MS - 1_000;
    useExpenseStore.setState({ expenses: [gasto({ updatedAt: previo })] });
    useExpenseStore.getState().updateExpense('e1', { description: 'Cena arreglada' });
    expect(useExpenseStore.getState().expenses[0]!.updatedAt).toBe(previo + 1);
  });

  it('dos updateExpense seguidos dan updatedAt estrictamente crecientes, aunque el reloj mockeado no avance', () => {
    useExpenseStore.getState().updateExpense('e1', { description: 'a' });
    const u1 = useExpenseStore.getState().expenses[0]!.updatedAt;
    useExpenseStore.getState().updateExpense('e1', { description: 'b' });
    const u2 = useExpenseStore.getState().expenses[0]!.updatedAt;
    expect(u2).toBeGreaterThan(u1);
  });
});

/** D2 del verifier: `updateGroup` no tenía ningún test de su propia estampa. */
describe('updateGroup también sana lo envenenado y respeta un previo adelantado', () => {
  it('con un previo envenenado (fuera de tolerancia), updateGroup sana a `now`', () => {
    useGroupStore.setState({ groups: [grupo({ updatedAt: 9e15 })] });
    useGroupStore.getState().updateGroup('g1', { name: 'Viaje 2' });
    expect(useGroupStore.getState().groups[0]!.updatedAt).toBe(NOW);
  });

  it('con un previo adelantado pero plausible, updateGroup da previo+1, no `now`', () => {
    const previo = NOW + TOLERANCIA_RELOJ_MS - 1_000;
    useGroupStore.setState({ groups: [grupo({ updatedAt: previo })] });
    useGroupStore.getState().updateGroup('g1', { name: 'Viaje 2' });
    expect(useGroupStore.getState().groups[0]!.updatedAt).toBe(previo + 1);
  });
});
