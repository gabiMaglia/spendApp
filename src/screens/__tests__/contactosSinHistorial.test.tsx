import React from 'react';
import { render } from '@testing-library/react-native';
import FriendsScreen from '@/app/(tabs)/friends';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * Un contacto sin historial económico **no dice «Saldado»** (PO, 2026-09-12). Recién
 * agregado por QR, no hubo cuentas: la fila muestra sólo el nombre.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

const YO   = { id: 'yo',   name: 'Yo',   isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;
const CARO = { id: 'caro', name: 'Caro', isDeleted: false } as User;

const GRUPO = {
  id: 'g1', name: 'Asado', memberIds: ['yo', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'yo', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as unknown as Group;

/** Yo pagué 1000 a medias con Beto, y Beto me devolvió 500: quedamos a mano. */
const GASTO = {
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 1000, currency: 'ARS', paidById: 'yo',
  splits: [{ userId: 'yo', amount: 500, isPaid: false }, { userId: 'beto', amount: 500, isPaid: false }],
  createdById: 'yo', createdAt: 0, updatedAt: 0, isDeleted: false, deletionVotes: [],
} as unknown as Expense;
const PAGO = {
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'yo', amount: 500, currency: 'ARS',
  createdById: 'beto', createdAt: 0, updatedAt: 0, isDeleted: false,
} as unknown as Payment;

beforeEach(() => {
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, BETO, CARO] });
  useGroupStore.setState({ groups: [GRUPO] });
  useExpenseStore.setState({ expenses: [GASTO] });
  usePaymentStore.setState({ payments: [PAGO] });
});

describe('Contactos: «Saldado» sólo si hubo cuentas', () => {
  it('con historial y saldo en cero dice «Saldado»; sin historial no dice nada', () => {
    const r = render(<FriendsScreen />);

    expect(r.getByText('Beto')).toBeTruthy();
    expect(r.getByText('Caro')).toBeTruthy();
    // Una sola fila dice «Saldado»: la de Beto. Caro nunca compartió nada.
    expect(r.getAllByText('common.settled')).toHaveLength(1);
  });

  it('un contacto nuevo sin ningún grupo no dice «Saldado»', () => {
    useGroupStore.setState({ groups: [] });
    useExpenseStore.setState({ expenses: [] });
    usePaymentStore.setState({ payments: [] });
    const r = render(<FriendsScreen />);

    expect(r.getByText('Beto')).toBeTruthy();
    expect(r.queryByText('common.settled')).toBeNull();
  });
});
