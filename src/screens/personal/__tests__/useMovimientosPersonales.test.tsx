import { renderHook } from '@testing-library/react-native';
import { useMovimientosPersonales } from '@/src/screens/personal/hooks/useMovimientosPersonales';
import { usePersonalMonthTotals } from '@/src/screens/personal/hooks/usePersonalMonthTotals';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupStore } from '@/src/store/groupStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import type { Expense, Payment, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const HOY = Date.now();
const gasto = { id: 'e1', groupId: 'g1', description: 'Cena', amount: 100_000, currency: 'ARS', paidById: 'yo',
  splits: [{ userId: 'yo', amount: 50_000 }, { userId: 'ana', amount: 50_000 }], splitMode: 'equal',
  category: 'food', date: HOY, createdAt: HOY, createdById: 'yo', updatedAt: HOY, isDeleted: false } as Expense;
const pago = { id: 'p1', groupId: 'g1', fromUserId: 'yo', toUserId: 'ana', amount: 20_000, currency: 'ARS',
  date: HOY, createdAt: HOY, createdById: 'yo', updatedAt: HOY, isDeleted: false } as Payment;

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo', name: 'Yo' } as User });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [gasto] });
  usePaymentStore.setState({ payments: [pago] });
  usePersonalStore.setState({ entries: [] });
});

describe('Personal derivado (T-229)', () => {
  it('lo que puse en el gasto y lo que pagué aparecen como movimientos', () => {
    const { result } = renderHook(() => useMovimientosPersonales());
    expect(result.current.map(x => x.id).sort()).toEqual(['pay_p1', 'rep_e1']);
  });

  it('Gastado del mes = 1.000 del gasto + 200 del pago', () => {
    const { result } = renderHook(() => usePersonalMonthTotals(toMonthKey(HOY)));
    expect(result.current.totalSpent).toBe(120_000);
  });

  it('borrar el gasto baja Gastado a 200', () => {
    useExpenseStore.setState({ expenses: [{ ...gasto, isDeleted: true }] });
    const { result } = renderHook(() => usePersonalMonthTotals(toMonthKey(HOY)));
    expect(result.current.totalSpent).toBe(20_000);
  });

  it('un cobro suma a Ingresos', () => {
    usePaymentStore.setState({ payments: [{ ...pago, fromUserId: 'ana', toUserId: 'yo' }] });
    const { result } = renderHook(() => usePersonalMonthTotals(toMonthKey(HOY)));
    expect(result.current.totalIncome).toBe(20_000);
  });
});
