import { purgarGrupoLocalmente } from '@/src/services/salirDelGrupo';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupStore } from '@/src/store/groupStore';
import { usePersonalStore } from '@/src/store/personalStore';
import type { Expense, Group, Payment, User } from '@/src/types/models';

jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const g = { id: 'g1', name: 'Viaje', memberIds: ['yo', 'ana'], miembros: {}, currency: 'ARS',
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false } as unknown as Group;
const e = { id: 'e1', groupId: 'g1', description: 'Cena', amount: 100_000, currency: 'ARS', paidById: 'yo',
  splits: [{ userId: 'yo', amount: 50_000 }, { userId: 'ana', amount: 50_000 }], splitMode: 'equal',
  category: 'food', date: 5, createdAt: 5, createdById: 'yo', updatedAt: 5, isDeleted: false } as Expense;
const p = { id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'yo', amount: 50_000, currency: 'ARS',
  date: 6, createdAt: 6, createdById: 'ana', updatedAt: 6, isDeleted: false } as Payment;

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  useGroupStore.setState({ groups: [g] });
  useExpenseStore.setState({ expenses: [e] });
  usePaymentStore.setState({ payments: [p] });
  usePersonalStore.setState({ entries: [] });
});

describe('salir de un grupo no borra mi historial de Personal (T-229)', () => {
  it('los movimientos del grupo quedan congelados con el mismo id, monto y nombre', () => {
    purgarGrupoLocalmente('g1');
    expect(useExpenseStore.getState().expenses).toEqual([]);
    const guardados = usePersonalStore.getState().entries;
    expect(guardados.map(x => x.id).sort()).toEqual(['pay_p1', 'rep_e1']);
    expect(guardados.find(x => x.id === 'rep_e1')).toMatchObject({ amount: 100_000, sourceGroupName: 'Viaje' });
  });

  it('purgar dos veces no duplica', () => {
    purgarGrupoLocalmente('g1');
    purgarGrupoLocalmente('g1');
    expect(usePersonalStore.getState().entries).toHaveLength(2);
  });
});
