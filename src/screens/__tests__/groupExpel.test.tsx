import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-182 Task 2 — expulsar desde la fila del miembro. Sólo el creador la ve, y
 * nunca sobre sí mismo.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

const grupo = (memberIds = ['ana', 'beto']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
  miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useGroupKeyStore.setState({ keys: [] });
  jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons) => {
    // Simula tocar el botón destructivo (confirmar) en cada alert.
    const confirmar = buttons?.find(b => b.style === 'destructive');
    confirmar?.onPress?.();
  });
});

afterEach(() => { jest.restoreAllMocks(); });

describe('expulsar (T-182 Task 2)', () => {
  it('el creador ve la opción sobre otro miembro y, al confirmar, lo expulsa', () => {
    useAuthStore.setState({ currentUser: ANA });
    useGroupStore.setState({ groups: [grupo()] });

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-beto'));

    expect(Alert.alert).toHaveBeenCalled();
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['ana']);
  });

  it('nombra el saldo absorbido cuando el expulsado debe plata', () => {
    useAuthStore.setState({ currentUser: ANA });
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] }); // beto debe 500.000 a ana

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-beto'));

    const [, cuerpo] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(cuerpo).toEqual(expect.stringContaining('group_detail.expel_body_with_balance'));

    expect(usePaymentStore.getState().payments).toHaveLength(1);
    expect(usePaymentStore.getState().payments[0]).toMatchObject({
      fromUserId: 'beto', toUserId: 'ana', amount: 500_000,
    });
  });

  it('sin saldo, el cuerpo del aviso es el simple (sin montos)', () => {
    useAuthStore.setState({ currentUser: ANA });
    useGroupStore.setState({ groups: [grupo()] });

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-beto'));

    const [, cuerpo] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(cuerpo).toEqual(expect.stringContaining('group_detail.expel_body'));
    expect(cuerpo).not.toEqual(expect.stringContaining('expel_body_with_balance'));
  });

  it('un no-creador NO ve la opción: tocar la fila de otro no hace nada', () => {
    useAuthStore.setState({ currentUser: BETO }); // beto no es el creador (ana)
    useGroupStore.setState({ groups: [grupo()] });

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-ana'));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['ana', 'beto']);
  });

  it('el creador tocando su PROPIA fila no dispara nada', () => {
    useAuthStore.setState({ currentUser: ANA });
    useGroupStore.setState({ groups: [grupo()] });

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-ana'));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['ana', 'beto']);
  });
});
