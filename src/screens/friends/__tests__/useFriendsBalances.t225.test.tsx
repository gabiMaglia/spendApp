import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useFriendsBalances } from '@/src/screens/friends/hooks/useFriendsBalances';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29): en Amigos, «Te deben» es la suma de lo que me debe
 * cada amigo y «Debés» la suma de lo que le debo a cada uno — sin compensar.
 * La tarjeta de cada amigo sí muestra el neto (ver `useGlobalPersonBalances`).
 */
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const grupo = (id: string, memberIds: string[]): Group => ({
  id, name: id, memberIds, currency: 'ARS', miembros: {},
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false,
} as Group);
let n = 0;
const gasto = (groupId: string, pagador: string, amount: number, partes: Record<string, number>): Expense => {
  n++;
  return {
    id: `e${n}`, groupId, description: 'x', amount, currency: 'ARS', paidById: pagador,
    splits: Object.entries(partes).map(([userId, a]) => ({ userId, amount: a, isPaid: false })),
    splitMode: 'custom', category: 'food', date: n, createdAt: n, createdById: pagador, updatedAt: n, isDeleted: false,
  } as Expense;
};

function leer<T>(hook: () => T): T {
  let out!: T;
  function Probe() { out = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

beforeEach(() => {
  useSettingsStore.setState({ displayCurrency: 'ARS' });
  useArchiveStore.setState({ archivedIds: [] });
  usePaymentStore.setState({ payments: [] });
  useGroupStore.setState({ groups: [grupo('g', ['yo', 'ana']), grupo('h', ['yo', 'beto'])] });
  useExpenseStore.setState({ expenses: [
    gasto('g', 'yo', 400, { yo: 200, ana: 200 }),  // Ana me debe 200
    gasto('g', 'ana', 120, { yo: 60, ana: 60 }),   // le debo 60 a Ana
    gasto('h', 'beto', 50, { yo: 25, beto: 25 }),  // le debo 25 a Beto
  ] });
});

describe('Amigos — casilleros sin compensar (T-225)', () => {
  it('Te deben suma lo que me debe cada amigo; Debés, lo que le debo a cada uno', () => {
    const r = leer(() => useFriendsBalances('yo'));
    expect(r.owedToYou).toBe(200);
    expect(r.youOwe).toBe(85);
  });

  it('las tarjetas siguen mostrando el neto de cada amigo', () => {
    const r = leer(() => useFriendsBalances('yo'));
    expect(r.personBalances).toEqual([
      { userId: 'ana', currency: 'ARS', amount: 140 },
      { userId: 'beto', currency: 'ARS', amount: -25 },
    ]);
  });
});
