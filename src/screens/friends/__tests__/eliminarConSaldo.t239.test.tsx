import React from 'react';
import { Alert, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { useFriendsContacts } from '@/src/screens/friends/hooks/useFriendsContacts';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * T-239: eliminar un amigo con saldo pendiente avisa antes de confirmar.
 * No bloquea: el contacto se puede eliminar igual (el historial queda).
 */
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const grupo = (id: string, memberIds: string[]): Group => ({
  id, name: id, memberIds, currency: 'ARS', miembros: {},
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false,
} as Group);
const gasto = (pagador: string, partes: Record<string, number>): Expense => ({
  id: 'e1', groupId: 'g', description: 'x', amount: 100, currency: 'ARS', paidById: pagador,
  splits: Object.entries(partes).map(([userId, a]) => ({ userId, amount: a, isPaid: false })),
  splitMode: 'custom', category: 'food', date: 1, createdAt: 1, createdById: pagador, updatedAt: 1, isDeleted: false,
} as Expense);

function leer<T>(hook: () => T): T {
  let out!: T;
  function Probe() { out = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

let alerta: jest.SpyInstance;
beforeEach(() => {
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAuthStore.setState({ currentUser: { id: 'yo', authProvider: 'google' } as never });
  useArchiveStore.setState({ archivedIds: [] });
  usePaymentStore.setState({ payments: [] });
  useGroupStore.setState({ groups: [grupo('g', ['yo', 'ana', 'beto'])] });
  useExpenseStore.setState({ expenses: [gasto('yo', { yo: 50, ana: 50 })] }); // Ana me debe 50
});
afterEach(() => alerta.mockRestore());

describe('Eliminar amigo (T-239)', () => {
  it('con saldo pendiente, el aviso lo dice', () => {
    leer(useFriendsContacts).handleRemove('ana', 'Ana');
    expect(alerta).toHaveBeenCalledWith('friends.remove_title', expect.stringMatching(/^friends\.remove_body_with_balance/), expect.any(Array));
  });

  it('sin saldo, el aviso de siempre', () => {
    leer(useFriendsContacts).handleRemove('beto', 'Beto');
    expect(alerta).toHaveBeenCalledWith('friends.remove_title', expect.stringMatching(/^friends\.remove_body\(/), expect.any(Array));
  });

  it('con saldo igual se puede eliminar: el botón destructivo sigue ahí', () => {
    leer(useFriendsContacts).handleRemove('ana', 'Ana');
    const botones = alerta.mock.calls[0][2] as { style?: string }[];
    expect(botones.some(b => b.style === 'destructive')).toBe(true);
  });
});
