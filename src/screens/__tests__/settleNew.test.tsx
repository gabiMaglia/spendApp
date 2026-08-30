import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SettleNewScreen from '@/app/settle/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * Saldar, como en Splitwise: elegís a la persona y el monto **ya viene puesto**
 * con lo que se debe. Pagar todo es el caso normal y tipearlo a mano deja
 * restos de un peso que después nadie entiende. Sigue siendo editable: un pago
 * parcial es escribir otro número encima.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ groupId: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana'  } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (): Group => ({
  // A propósito Beto primero: el que paga tiene que ser YO, no el primero
  // de la lista.
  id: 'g1', name: 'Viaje', memberIds: ['beto', 'ana'], currency: 'ARS',
  createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

/** Beto pone 10.000 y se reparte en partes iguales ⇒ Ana le debe 5.000. */
const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'beto', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  memberIds: ['beto', 'ana'], category: 'transport', date: 0, createdAt: 0,
  createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, BETO] });
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({ expenses: [gasto()] });
  usePaymentStore.setState({ payments: [] });
});

describe('el monto llega puesto', () => {
  it('al abrir ya está el total que se debe', () => {
    // Beto puso 10.000 a medias ⇒ Ana le debe 5.000 (500.000 en menor unidad).
    const { getByDisplayValue } = render(<SettleNewScreen />);
    expect(getByDisplayValue(/5\.000/)).toBeTruthy();
  });

  // Un pago parcial es simplemente escribir otro número: el autocompletado no
  // puede pisar lo que la persona está tipeando.
  it('editarlo a mano no se pisa solo', () => {
    const { getByDisplayValue } = render(<SettleNewScreen />);

    // El separador de miles ahora se agrupa MIENTRAS se tipea (PO 2026-08-30,
    // reemplaza F-16b.4): se escribe "2000" y se ve "2.000". Lo que este test
    // prueba —que lo tipeado a mano no se pise solo— no cambia.
    fireEvent.changeText(getByDisplayValue(/5\.000/), '2000');

    expect(getByDisplayValue('2.000')).toBeTruthy();
  });

  it('el que paga soy yo, no el primer miembro de la lista', () => {
    // El grupo es ['beto','ana'] y yo soy Ana: si tomara el primero, el pago
    // saldría de Beto y habría que corregirlo a mano cada vez.
    const { getAllByText, queryAllByText } = render(<SettleNewScreen />);

    expect(getAllByText('common.you').length).toBeGreaterThan(0);
    expect(queryAllByText('Ana')).toHaveLength(0); // aparezco como "vos"
  });

  /**
   * Ahora que el sync es en vivo, un pago del otro teléfono puede llegar
   * MIENTRAS estás tipeando. Recalcular el monto en ese momento te borraría lo
   * que escribiste sin que entiendas por qué.
   */
  it('un pago que llega por sync no pisa lo que estás tipeando', () => {
    const { getByDisplayValue } = render(<SettleNewScreen />);

    fireEvent.changeText(getByDisplayValue(/5\.000/), '2000');

    act(() => {
      usePaymentStore.setState({ payments: [{
        id: 'p-remoto', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
        amount: 100_000, currency: 'ARS', date: 0,
        createdAt: 0, createdById: 'beto', updatedAt: 0, isDeleted: false,
      } as Payment] });
    });

    expect(getByDisplayValue('2.000')).toBeTruthy();
  });

  it('el chip permite volver al total después de editar', () => {
    const { getByText, getByDisplayValue } = render(<SettleNewScreen />);

    fireEvent.changeText(getByDisplayValue(/5\.000/), '2000');
    fireEvent.press(getByText(/whole_debt|5\.000/));

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

  // Mejor decirlo que dejar un formulario mudo con un cero.
  it('avisa cuando el grupo ya está saldado', () => {
    usePaymentStore.setState({ payments: [{
      id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
      amount: 500_000, currency: 'ARS', date: 0,
      createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
    } as Payment] });

    const { getByText } = render(<SettleNewScreen />);
    expect(getByText('settle.all_settled')).toBeTruthy();
  });
});
