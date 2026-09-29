import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import FriendsScreen from '@/app/(tabs)/friends';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29): el «Saldar» de la tarjeta de un amigo depende de si
 * YO le debo algo (`iOwe > 0`), no del neto: si le debo 60 y me debe 200, la
 * tarjeta dice «Te debe 140» y aun así tengo 60 para saldar.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

const YO  = { id: 'yo',  name: 'Yo',  isDeleted: false } as User;
const ANA = { id: 'ana', name: 'Ana', isDeleted: false } as User;

const GRUPO = {
  id: 'g1', name: 'Viaje', memberIds: ['yo', 'ana'], currency: 'ARS', miembros: {},
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false,
} as unknown as Group;

let n = 0;
const gasto = (paidById: string, partes: Record<string, number>): Expense => {
  n++;
  return {
    id: `e${n}`, groupId: 'g1', description: 'x', currency: 'ARS', paidById, splitMode: 'custom',
    amount: Object.values(partes).reduce((s, x) => s + x, 0),
    splits: Object.entries(partes).map(([userId, amount]) => ({ userId, amount, isPaid: false })),
    category: 'other', date: 0, createdAt: 0, createdById: paidById, updatedAt: 0, isDeleted: false,
  } as unknown as Expense;
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, ANA] });
  useGroupStore.setState({ groups: [GRUPO] });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('Amigos: «Saldar» mira lo que le debo, no el neto', () => {
  it('le debo 60 y me debe 200 (neto a favor): igual se ofrece Saldar', () => {
    useExpenseStore.setState({ expenses: [
      gasto('yo',  { yo: 20_000, ana: 20_000 }),
      gasto('ana', { yo: 6_000,  ana: 6_000 }),
    ] });
    const r = render(<FriendsScreen />);
    expect(r.getByText('friends.settle')).toBeTruthy();
  });

  it('sólo me debe ella (no le debo nada): no se ofrece Saldar', () => {
    useExpenseStore.setState({ expenses: [gasto('yo', { yo: 20_000, ana: 20_000 })] });
    const r = render(<FriendsScreen />);
    expect(r.queryByText('friends.settle')).toBeNull();
  });

  it('Saldar abre la pantalla en modo Amigos: sólo la persona, sin monto ni grupo', () => {
    useExpenseStore.setState({ expenses: [gasto('ana', { yo: 6_000, ana: 6_000 })] });
    const r = render(<FriendsScreen />);
    fireEvent.press(r.getByText('friends.settle'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/settle/new', params: { toId: 'ana' } });
  });
});
