import { applyDueRecurring, rehydrateForActiveUser } from '../session';
import { useRecurringStore } from '../recurringStore';
import { useExpenseStore } from '../expenseStore';
import { useAuthStore } from '../authStore';
import { listErrors } from '@/src/services/errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { RecurringExpense, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  startRelay: jest.fn(async () => {}), reiniciarSyncPorCambioDeCuenta: jest.fn(),
  schedulePublish: jest.fn(), deviceId: () => 'dev',
}));

const mockStartRelay = jest.requireMock('@/src/sync/motor/relayEngine').startRelay as jest.Mock;
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);

function plantilla(id: string, over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id, groupId: 'g1', description: 'Alquiler', amount: 1001, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub'], category: 'other',
    rule: { frequency: 'monthly', startDate: d(2026, 1, 10) },
    lastMaterializedAt: null, isActive: true,
    createdAt: 0, createdById: 'ua', updatedAt: 0, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  mockStartRelay.mockClear();
  useAuthStore.setState({ currentUser: { id: 'ua' } as User });
  useExpenseStore.setState({ expenses: [] });
});

describe('plantilla vieja sin valores (T-251)', () => {
  it('materializa en partes iguales y deja el error anotado', () => {
    useRecurringStore.setState({ recurring: [plantilla('viejo', { splitMode: 'percentage' })] });
    applyDueRecurring(d(2026, 1, 15));
    const e = useExpenseStore.getState().expenses;
    expect(e).toHaveLength(1);
    expect(e[0]!.splits.map(s => s.amount).sort()).toEqual([500, 501]);
    expect(listErrors().length).toBeGreaterThan(0);
  });
});

describe('una plantilla que no se puede materializar', () => {
  it('no frena a las demás', () => {
    useRecurringStore.setState({ recurring: [
      plantilla('rota', { rule: null as never }),
      plantilla('buena'),
    ] });
    expect(() => applyDueRecurring(d(2026, 1, 15))).not.toThrow();
    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual([`rec_buena_${d(2026, 1, 10)}`]);
    expect(listErrors().length).toBeGreaterThan(0);
  });
});

describe('rehydrateForActiveUser', () => {
  it('llega a startRelay aunque los recurrentes exploten', () => {
    useRecurringStore.getState().addRecurring(plantilla('x'));
    const orig = useRecurringStore.getState().updateRecurring;
    useRecurringStore.setState({ updateRecurring: () => { throw new Error('boom'); } });
    try {
      expect(() => rehydrateForActiveUser()).not.toThrow();
      expect(mockStartRelay).toHaveBeenCalledWith(true);
    } finally {
      useRecurringStore.setState({ updateRecurring: orig });
    }
  });
});
