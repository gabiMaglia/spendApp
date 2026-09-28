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

describe('E2 · el creador expulsa a alguien que DEBE 100', () => {
  beforeEach(() => {
    // Beto pagó 0, le tocan 500.000 de un gasto de Ana → Beto debe 500.000 a Ana.
    useExpenseStore.setState({ expenses: [gasto()] });
  });

  it('genera un pago derivado beto→ana, y el neto de beto queda en cero', () => {
    expect(expulsar('g1', 'beto', AHORA)).toBe('ok');

    const pagos = usePaymentStore.getState().payments;
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({
      groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 500_000, currency: 'ARS',
    });
    expect(pagos[0]!.id).toBe(`expel:g1:beto:${AHORA}:0`);
  });

  it('el pago derivado cuenta para el balance (T-186: sin acuse)', () => {
    expulsar('g1', 'beto', AHORA);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pagosQueCuentan } = require('@/src/algorithms/settlementStatus');
    const pagos = usePaymentStore.getState().payments;
    const g = useGroupStore.getState().getById('g1')!;
    expect(pagosQueCuentan(pagos, g)).toHaveLength(1);
  });
});

describe('E3 · el creador expulsa a alguien a quien le DEBEN 100', () => {
  it('genera un pago derivado ana→beto', () => {
    // Beto pagó todo (1.000.000), le toca la mitad (500.000) → le deben 500.000.
    useExpenseStore.setState({ expenses: [gasto({ paidById: 'beto' })] });

    expect(expulsar('g1', 'beto', AHORA)).toBe('ok');

    const pagos = usePaymentStore.getState().payments;
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({
      groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500_000, currency: 'ARS',
    });
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

describe('E6 · Z expulsado con saldo en DOS monedas', () => {
  it('un pago derivado por moneda', () => {
    useGroupStore.setState({ groups: [grupo({ memberIds: ['ana', 'beto'] })] });
    useExpenseStore.setState({
      expenses: [
        gasto({ id: 'e1', currency: 'ARS' }), // beto debe 500.000 ARS
        gasto({ id: 'e2', currency: 'USD', paidById: 'beto', splits: [
          { userId: 'ana', amount: 20_000, isPaid: false }, { userId: 'beto', amount: 20_000, isPaid: false },
        ] }), // ana le debe 20.000 USD a beto
      ],
    });

    expect(expulsar('g1', 'beto', AHORA)).toBe('ok');

    const pagos = usePaymentStore.getState().payments;
    expect(pagos).toHaveLength(2);
    expect(pagos.map(p => p.currency).sort()).toEqual(['ARS', 'USD']);
  });
});

describe('grupo inexistente o borrado', () => {
  it("devuelve 'no_miembro' sin tocar nada", () => {
    expect(expulsar('g-no-existe', 'beto', AHORA)).toBe('no_miembro');
  });
});
