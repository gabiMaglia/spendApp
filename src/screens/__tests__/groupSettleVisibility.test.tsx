import React from 'react';
import { render } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, Group, Payment, SettlementConfirmation, User } from '@/src/types/models';

/**
 * "Saldar deuda" solo aparece si el grupo tiene al menos una DEUDA VIVA, en
 * cualquier moneda (PO, T-104). Antes se ofrecía con solo tener un gasto
 * cargado (PO 2026-08-30) y eso mandaba a la pantalla de saldar aun cuando ya
 * no había nada que saldar (gastos compensados, pagos hechos, multi-moneda en
 * cero). Usa la misma fuente que ya calcula el balance de la pantalla
 * (`useGroupBalance`, que corre `calculateBalancesByCurrency` + `pagosQueCuentan`),
 * así que un saldado pendiente de acuse en un grupo `consensus` (T-064) ya
 * cuenta como si estuviera pagado y no mantiene el botón visible.
 */
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 100_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 50_000 }, { userId: 'beto', amount: 50_000 }],
  splitMode: 'equal', category: 'transport', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana',
  amount: 50_000, currency: 'ARS', date: 0, createdAt: 0,
  createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation => ({
  userId: 'ana', confirmedAt: 1_000, action: 'confirm', ...o,
});

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'ana', name: 'Ana' } as User });
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
});

describe('visibilidad de "saldar deuda" (T-104: deuda viva, no solo gastos)', () => {
  it('sin gastos NO se ofrece: no hay deuda posible', () => {
    useExpenseStore.setState({ expenses: [] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('un gasto que deja deuda viva SI se ofrece', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('settle-debts')).toBeTruthy();
  });

  it('un grupo cuyo único gasto se borró vuelve a estar vacío (sin deuda)', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('un gasto de OTRO grupo no habilita el botón', () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e9', groupId: 'g-otro' })] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('gastos que se compensan entre sí (deuda neta cero) NO se ofrece', () => {
    // Ana paga 100.000 partido a medias, y luego Beto paga otros 100.000
    // también partidos a medias: al neto nadie le debe nada a nadie.
    useExpenseStore.setState({
      expenses: [
        gasto({ id: 'e1', paidById: 'ana', amount: 100_000 }),
        gasto({
          id: 'e2', paidById: 'beto', amount: 100_000,
          splits: [{ userId: 'ana', amount: 50_000, isPaid: false }, { userId: 'beto', amount: 50_000, isPaid: false }],
        }),
      ],
    });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('un pago que salda la deuda por completo NO se ofrece (grupo open)', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    usePaymentStore.setState({ payments: [pago()] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('multi-moneda: deuda viva en una sola moneda SI se ofrece', () => {
    useExpenseStore.setState({
      expenses: [
        gasto({ id: 'e1', currency: 'ARS' }), // deuda viva en ARS
        gasto({
          id: 'e2', currency: 'USD', amount: 100, paidById: 'beto',
          splits: [{ userId: 'ana', amount: 50, isPaid: false }, { userId: 'beto', amount: 50, isPaid: false }],
        }),
      ],
      // el gasto en USD ya está saldado con un pago exacto
    });
    usePaymentStore.setState({ payments: [pago({ id: 'p-usd', currency: 'USD', amount: 50, fromUserId: 'ana', toUserId: 'beto' })] });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('settle-debts')).toBeTruthy();
  });

  it('multi-moneda: todas las monedas en cero NO se ofrece', () => {
    useExpenseStore.setState({
      expenses: [
        gasto({ id: 'e1', currency: 'ARS' }),
        gasto({
          id: 'e2', currency: 'USD', amount: 100, paidById: 'beto',
          splits: [{ userId: 'ana', amount: 50, isPaid: false }, { userId: 'beto', amount: 50, isPaid: false }],
        }),
      ],
    });
    usePaymentStore.setState({
      payments: [
        pago({ id: 'p-ars', currency: 'ARS', amount: 50_000, fromUserId: 'beto', toUserId: 'ana' }),
        pago({ id: 'p-usd', currency: 'USD', amount: 50, fromUserId: 'ana', toUserId: 'beto' }),
      ],
    });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('grupo consensus con saldado pendiente de acuse (T-064): esa deuda no cuenta como viva, no se ofrece', () => {
    useGroupStore.setState({ groups: [grupo({ deletionMode: 'consensus' })] });
    useExpenseStore.setState({ expenses: [gasto()] });
    // Beto (deudor) declara el pago; Ana (quien cobra) todavía no acusó recibo.
    usePaymentStore.setState({ payments: [pago({ createdById: 'beto' })] });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('grupo consensus con saldado RECHAZADO: la deuda vuelve a estar viva, SI se ofrece', () => {
    useGroupStore.setState({ groups: [grupo({ deletionMode: 'consensus' })] });
    useExpenseStore.setState({ expenses: [gasto()] });
    usePaymentStore.setState({
      payments: [pago({ createdById: 'beto', confirmations: [acuse({ action: 'reject' })] })],
    });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('settle-debts')).toBeTruthy();
  });

  it('deuda entre OTROS miembros con la mía en cero: NO se ofrece (coincide con el «Saldado» de la pantalla)', () => {
    // El criterio es la deuda de quien mira, la misma que muestra el encabezado del grupo.
    useGroupStore.setState({ groups: [grupo({ memberIds: ['ana', 'beto', 'caro'] })] });
    useExpenseStore.setState({
      expenses: [gasto({
        id: 'e1', paidById: 'caro', amount: 100_000,
        splits: [{ userId: 'beto', amount: 100_000, isPaid: false }],
      })],
    });
    const { queryByTestId } = render(<GroupDetailScreen />);
    expect(queryByTestId('settle-debts')).toBeNull();
  });

  it('agregar gasto se ofrece SIEMPRE, incluso sin deuda viva', () => {
    useExpenseStore.setState({ expenses: [] });
    const { getByTestId } = render(<GroupDetailScreen />);
    expect(getByTestId('add-expense')).toBeTruthy();
  });
});
