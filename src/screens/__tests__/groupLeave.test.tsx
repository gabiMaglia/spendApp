import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * Salir de un grupo con saldo abierto.
 *
 * `canLeaveGroup` existía y estaba testeado, pero NO LO LLAMABA NADIE — la misma
 * clase de bug que el plazo de borrado que nunca vencía. Se salía con deuda y
 * los números dejaban de cerrar EN SILENCIO: al sacarte de `memberIds`, tu
 * saldo desaparece del cálculo y las cuentas de los que quedan ya no suman.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

/** Ana NO es la creadora: el creador ve "eliminar", los demás ven "salir". */
const grupo = (memberIds = ['ana', 'beto']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
  createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

/** Beto puso 10.000 a medias ⇒ Ana le debe 5.000. */
const gastoConDeuda = (): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 1_000_000, currency: 'ARS',
  paidById: 'beto', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000, isPaid: false },
           { userId: 'beto', amount: 500_000, isPaid: false }],
  category: 'food', date: 0, createdAt: 0, createdById: 'beto',
  deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Expense);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

const salir = (r: ReturnType<typeof render>) =>
  fireEvent.press(r.getByText('group_detail.leave_group'));

describe('salir del grupo', () => {
  it('sin deudas, pregunta y deja salir', () => {
    salir(render(<GroupDetailScreen />));

    expect(Alert.alert).toHaveBeenCalledWith(
      'group_detail.leave_title',
      'group_detail.leave_body',
      expect.anything(),
    );
  });

  it('CON deuda, NO deja salir y explica por qué', () => {
    useExpenseStore.setState({ expenses: [gastoConDeuda()] });

    salir(render(<GroupDetailScreen />));

    expect(Alert.alert).toHaveBeenCalledWith(
      'group_detail.leave_blocked_title',
      expect.stringContaining('leave_needs_settle'),
      expect.anything(),
    );
  });

  it('con deuda, el grupo NO se toca', () => {
    useExpenseStore.setState({ expenses: [gastoConDeuda()] });

    salir(render(<GroupDetailScreen />));

    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain('ana');
  });

  // Ofrecer "salir" acá sería mentir: no hay a quién pasarle el saldo.
  it('último miembro con saldo: no hay salida posible y se dice', () => {
    useGroupStore.setState({ groups: [grupo(['ana'])] });
    useExpenseStore.setState({ expenses: [{
      ...gastoConDeuda(), paidById: 'ana',
      splits: [{ userId: 'ana', amount: 500_000, isPaid: false }],
    } as Expense] });

    salir(render(<GroupDetailScreen />));

    expect(Alert.alert).toHaveBeenCalledWith(
      'group_detail.leave_blocked_title',
      'group_detail.leave_last_member',
    );
  });

  // Bloquear sin ofrecer la salida deja al usuario adivinando qué hacer.
  it('el bloqueo ofrece ir a saldar', () => {
    useExpenseStore.setState({ expenses: [gastoConDeuda()] });

    salir(render(<GroupDetailScreen />));

    const botones = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string }[];
    expect(botones.map(b => b.text)).toContain('group_detail.settle_debts');
  });
});
