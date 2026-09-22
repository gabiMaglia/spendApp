import React from 'react';
import { render } from '@testing-library/react-native';
import ActivityScreen from '@/app/(tabs)/activity';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * **Tu parte de CADA gasto, en Actividad** (PO 2026-09-22).
 *
 * El monto grande de una fila de gasto es el TOTAL del gasto — no dice si a
 * VOS te conviene o te perjudica. Debajo, más chico y en color, va lo que te
 * toca a vos en ESE gasto puntual: verde si te deben tu parte, rojo si la
 * debés vos. Sólo en gastos DE GRUPO — uno personal no tiene de quién
 * depender.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;
const AHORA = 1_800_000_000_000;

const grupo: Group = {
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, BETO] });
  useGroupStore.setState({ groups: [grupo] });
  usePaymentStore.setState({ payments: [] });
});

describe('Actividad — mi parte de cada gasto de grupo', () => {
  it('cuando pagué yo, muestra en verde lo que me deben de vuelta', () => {
    const gasto = {
      id: 'e1', groupId: 'g1', description: 'Carne', amount: 200_000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 100_000, isPaid: true },
        { userId: 'beto', amount: 100_000, isPaid: false },
      ],
      category: 'food', date: AHORA, createdAt: AHORA, createdById: 'ana',
      deletionVotes: [], updatedAt: AHORA, isDeleted: false,
    } as Expense;
    useExpenseStore.setState({ expenses: [gasto] });

    const r = render(<ActivityScreen />);

    expect(r.getByText('$2.000')).toBeTruthy();          // total del gasto
    expect(r.getByTestId('activity-mi-parte')).toHaveTextContent('+$1.000');
  });

  it('cuando pagó otro, muestra en rojo lo que debo yo', () => {
    const gasto = {
      id: 'e2', groupId: 'g1', description: 'Bebidas', amount: 200_000, currency: 'ARS',
      paidById: 'beto', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 100_000, isPaid: false },
        { userId: 'beto', amount: 100_000, isPaid: true },
      ],
      category: 'food', date: AHORA, createdAt: AHORA, createdById: 'ana',
      deletionVotes: [], updatedAt: AHORA, isDeleted: false,
    } as Expense;
    useExpenseStore.setState({ expenses: [gasto] });

    const r = render(<ActivityScreen />);

    expect(r.getByTestId('activity-mi-parte')).toHaveTextContent('-$1.000');
  });

  it('en un gasto PERSONAL no muestra ningún indicador de mi parte', () => {
    const gastoPersonal = {
      id: 'p1', groupId: '', description: 'Café', amount: 5_000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal', splits: [{ userId: 'ana', amount: 5_000, isPaid: true }],
      category: 'other', date: AHORA, createdAt: AHORA, createdById: 'ana',
      deletionVotes: [], updatedAt: AHORA, isDeleted: false,
    } as Expense;
    useExpenseStore.setState({ expenses: [gastoPersonal] });

    const r = render(<ActivityScreen />);

    expect(r.queryByTestId('activity-mi-parte')).toBeNull();
  });

  it('si el gasto está dividido exacto (nadie debe nada), no muestra indicador', () => {
    const gasto = {
      id: 'e3', groupId: 'g1', description: 'Nada que saldar', amount: 200_000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 200_000, isPaid: true },
        { userId: 'beto', amount: 0, isPaid: true },
      ],
      category: 'food', date: AHORA, createdAt: AHORA, createdById: 'ana',
      deletionVotes: [], updatedAt: AHORA, isDeleted: false,
    } as Expense;
    useExpenseStore.setState({ expenses: [gasto] });

    const r = render(<ActivityScreen />);

    expect(r.queryByTestId('activity-mi-parte')).toBeNull();
  });
});
