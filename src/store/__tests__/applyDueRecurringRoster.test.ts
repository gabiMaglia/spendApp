import { applyDueRecurring } from '../session';
import { useRecurringStore } from '../recurringStore';
import { useExpenseStore } from '../expenseStore';
import { useGroupStore } from '../groupStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, RecurringExpense, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  startRelay: jest.fn(async () => {}), reiniciarSyncPorCambioDeCuenta: jest.fn(),
  schedulePublish: jest.fn(), deviceId: () => 'dev',
}));

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12).getTime();

const plantilla = (over: Partial<RecurringExpense> = {}) => ({
  id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 30000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub', 'uc'], category: 'other',
  rule: { frequency: 'monthly', startDate: d(2026, 1, 10) },
  lastMaterializedAt: null, isActive: true,
  createdAt: 0, createdById: 'ua', updatedAt: 0, isDeleted: false,
  ...over,
}) as RecurringExpense;

const grupo = (memberIds: string[]) =>
  ({ id: 'g1', name: 'Depto', memberIds, currency: 'ARS', miembros: {} }) as unknown as Group;

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'ua' } as User });
  useExpenseStore.setState({ expenses: [] });
});

describe('applyDueRecurring con el roster real del grupo (T-262)', () => {
  it('después de que uc sale, la cuota nueva no lo incluye', () => {
    useGroupStore.setState({ groups: [grupo(['ua', 'ub'])] });
    useRecurringStore.setState({ recurring: [plantilla()] });
    applyDueRecurring(d(2026, 1, 15));
    const e = useExpenseStore.getState().expenses;
    expect(e).toHaveLength(1);
    expect(e[0]!.splits.map(s => s.userId).sort()).toEqual(['ua', 'ub']);
  });

  it('si el pagador salió, no crea el gasto ni avanza la plantilla', () => {
    useGroupStore.setState({ groups: [grupo(['ub', 'uc'])] });
    useRecurringStore.setState({ recurring: [plantilla()] });
    applyDueRecurring(d(2026, 1, 15));
    expect(useExpenseStore.getState().expenses).toHaveLength(0);
    expect(useRecurringStore.getState().recurring[0]!.lastMaterializedAt).toBeNull();
  });
});
