import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SettleNewScreen from '@/app/settle/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * El botón "toda la deuda": el caso normal al saldar es pagar TODO, y
 * escribirlo a mano deja restos de un peso que después nadie entiende.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ groupId: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana'  } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

/** Beto pone 10.000 y se reparte en partes iguales ⇒ Ana le debe 5.000. */
const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'beto', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  memberIds: ['ana', 'beto'], category: 'transport', date: 0, createdAt: 0,
  createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, BETO] });
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({ expenses: [gasto()] });
  usePaymentStore.setState({ payments: [] });
});

describe('atajo de deuda completa', () => {
  it('ofrece el total exacto que se debe', () => {
    const { getByText } = render(<SettleNewScreen />);
    // 500.000 en menor unidad = $5.000,00
    expect(getByText(/5\.000/)).toBeTruthy();
  });

  it('tocarlo completa el monto', () => {
    const { getByText, getByDisplayValue } = render(<SettleNewScreen />);

    fireEvent.press(getByText(/settle.whole_debt|5\.000/));

    expect(getByDisplayValue(/5\.000/)).toBeTruthy();
  });

  // Los pagos ya hechos cuentan: ofrecer de nuevo el total original haría pagar
  // dos veces.
  it('descuenta lo ya pagado', () => {
    usePaymentStore.setState({ payments: [{
      id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
      amount: 200_000, currency: 'ARS', date: 0,
      createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
    } as Payment] });

    const { getByText } = render(<SettleNewScreen />);
    expect(getByText(/3\.000/)).toBeTruthy();
  });

  it('sin deuda no se ofrece el atajo', () => {
    useExpenseStore.setState({ expenses: [] });

    const { queryByText } = render(<SettleNewScreen />);
    expect(queryByText(/settle\.whole_debt/)).toBeNull();
  });
});
