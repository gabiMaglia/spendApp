import { MemoryStorage } from '@/src/utils/createStorage';
import { useAuthStore } from '../authStore';
import { useExpenseStore } from '../expenseStore';
import { wipeAllAccounts } from '../wipeDevice';
import { discardScopedWrites, SCOPED_WRITE_DELAY_MS } from '../userScope';
import { registrarVaciadoEnBackground } from '../flushOnBackground';
import type { Expense } from '@/src/types/models';

const A = { id: 'userA' } as const;

const gasto = (i: number): Expense => ({
  id: `e${i}`, groupId: '', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'userA', splitMode: 'equal', splits: [], memberIds: ['userA'],
  category: 'food', date: 0, createdAt: 0, createdById: 'userA', deletionVotes: [],
  updatedAt: 0, isDeleted: false,
} as unknown as Expense);

describe('T-156 — persistencia diferida enchufada en los stores', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAuthStore.setState({ currentUser: A as never, isPro: false, isLoading: false });
    useExpenseStore.setState({ expenses: [], isLoading: true });
  });

  afterEach(() => {
    discardScopedWrites();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(a) 50 addExpense seguidos → 1 sola escritura a disco para la clave de gastos', () => {
    const setSpy = jest.spyOn(MemoryStorage.prototype, 'set');

    for (let i = 0; i < 50; i++) {
      useExpenseStore.getState().addExpense(gasto(i));
    }
    // Los 50 quedan en memoria (Zustand) YA — nada de esto depende del timer.
    expect(useExpenseStore.getState().expenses).toHaveLength(50);

    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);

    const escriturasDeGastos = setSpy.mock.calls.filter(
      ([key]) => typeof key === 'string' && key.startsWith('data_v1::u:userA'),
    );
    expect(escriturasDeGastos).toHaveLength(1);
  });

  it('(b) wipeAllAccounts() con una escritura pendiente → nada la reescribe después', () => {
    useExpenseStore.getState().addExpense(gasto(1));

    const setSpy = jest.spyOn(MemoryStorage.prototype, 'set');
    wipeAllAccounts();
    setSpy.mockClear();

    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS * 3);

    // Nada resucita después del wipe: ni el bucket de gastos ni ningún otro.
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('(c) registrarVaciadoEnBackground(): pasar a background vacía lo pendiente YA', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as typeof import('react-native');
    let appStateCb: (s: string) => void = () => {};
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
      appStateCb = cb;
      return { remove: jest.fn() };
    }) as typeof RN.AppState.addEventListener);

    const unsub = registrarVaciadoEnBackground();

    useExpenseStore.getState().addExpense(gasto(1));
    const setSpy = jest.spyOn(MemoryStorage.prototype, 'set');

    appStateCb('background');

    const escriturasDeGastos = setSpy.mock.calls.filter(
      ([key]) => typeof key === 'string' && key.startsWith('data_v1::u:userA'),
    );
    expect(escriturasDeGastos).toHaveLength(1);

    unsub();
  });
});
