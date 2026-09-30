import { expulsar } from '../expulsarDelGrupo';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const AHORA = Date.UTC(2026, 8, 27, 12);

const grupo = (over: Partial<Group> = {}): Group => {
  const memberIds = over.memberIds ?? ['ana', 'beto'];
  return {
    id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
    miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
    createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
    ...over,
  } as Group;
};

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function reset() {
  (['groups', 'expenses', 'payments'] as const).forEach(b => createSecureStorage(b).clearAll());
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
}

beforeEach(() => {
  reset();
  useAuthStore.setState({ currentUser: { id: 'ana' } as User });
  useGroupStore.setState({ groups: [grupo()] });
});

describe('E1 · el creador expulsa a alguien sin saldo', () => {
  it('devuelve ok, y beto queda out (fuera de memberIds)', () => {
    expect(expulsar('g1', 'beto', AHORA)).toBe('ok');
    const g = useGroupStore.getState().getById('g1')!;
    expect(g.memberIds).toEqual(['ana']);
    expect(g.miembros.beto).toEqual({ estado: 'out', at: AHORA });
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });
});

describe('E2 · el creador intenta expulsar a alguien que DEBE', () => {
  it("devuelve 'con_deuda', beto sigue adentro y no hay pagos", () => {
    useExpenseStore.setState({ expenses: [gasto()] }); // beto le debe 500.000 a ana
    expect(expulsar('g1', 'beto', AHORA)).toBe('con_deuda');
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['ana', 'beto']);
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });
});

describe('E3 · el creador intenta expulsar a alguien a quien le DEBEN', () => {
  it("devuelve 'con_deuda'", () => {
    useExpenseStore.setState({ expenses: [gasto({ paidById: 'beto' })] }); // ana le debe a beto
    expect(expulsar('g1', 'beto', AHORA)).toBe('con_deuda');
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });
});

describe('E4 · quien NO es el creador intenta expulsar', () => {
  it("devuelve 'no_creador' y nada cambia", () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User }); // beto no es el creador (ana)

    expect(expulsar('g1', 'ana', AHORA)).toBe('no_creador');
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['ana', 'beto']);
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });
});

describe('E5 · expulsar a alguien que ya no es miembro', () => {
  it("devuelve 'no_miembro'", () => {
    expect(expulsar('g1', 'caro', AHORA)).toBe('no_miembro');
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });
});

describe('E6 · deudas cruzadas con neto 0', () => {
  it("igual devuelve 'con_deuda'", () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e1' }), gasto({ id: 'e2', paidById: 'beto' })] });
    expect(expulsar('g1', 'beto', AHORA)).toBe('con_deuda');
  });
});

describe('E7 · deuda saldada con un pago', () => {
  it("devuelve 'ok' y no crea pagos nuevos", () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    usePaymentStore.setState({ payments: [{
      id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 500_000, currency: 'ARS',
      date: 1, createdAt: 1, createdById: 'beto', updatedAt: 1, isDeleted: false,
    }] });
    expect(expulsar('g1', 'beto', AHORA)).toBe('ok');
    expect(usePaymentStore.getState().payments).toHaveLength(1);
  });
});

describe('grupo inexistente o borrado', () => {
  it("devuelve 'no_miembro' sin tocar nada", () => {
    expect(expulsar('g-no-existe', 'beto', AHORA)).toBe('no_miembro');
  });
});
