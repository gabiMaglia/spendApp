import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ActivityScreen from '@/app/(tabs)/activity';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-116 (PO 2026-09-13): las pestañas de Actividad van «Todos», «Personal»
 * (movimientos sin grupo) y después una por grupo, EN ESE ORDEN. Elegir
 * "Personal" filtra el feed a sólo esos movimientos.
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
const AHORA = 1_800_000_000_000;

const grupo: Group = {
  id: 'g1', name: 'Asado', memberIds: ['ana'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

const gastoDeGrupo = {
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 100_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [{ userId: 'ana', amount: 100_000, isPaid: true }],
  category: 'food', date: AHORA, createdAt: AHORA, createdById: 'ana',
  deletionVotes: [], updatedAt: AHORA, isDeleted: false,
} as Expense;

const gastoPersonal = {
  id: 'p1', groupId: '', description: 'Café', amount: 5_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [{ userId: 'ana', amount: 5_000, isPaid: true }],
  category: 'other', date: AHORA, createdAt: AHORA, createdById: 'ana',
  deletionVotes: [], updatedAt: AHORA, isDeleted: false,
} as Expense;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [grupo] });
  usePaymentStore.setState({ payments: [] });
  useExpenseStore.setState({ expenses: [gastoDeGrupo, gastoPersonal] });
});

describe('Actividad — pestaña "Personal" (T-116)', () => {
  it('el orden de las pestañas es Todos, Personal, y después el grupo', () => {
    const r = render(<ActivityScreen />);
    const tabs = r.getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    // El texto visible de cada pestaña, en el orden en que React las montó.
    const etiquetas = tabs.map(tab => {
      const textos = tab.findAllByType(require('react-native').Text).map((t: { props: { children: unknown } }) => t.props.children);
      return textos.flat().join('');
    });
    expect(etiquetas).toEqual(['activity.filter_all', 'activity.filter_personal', 'Asado']);
  });

  it('elegir "Personal" muestra sólo el movimiento sin grupo', () => {
    const r = render(<ActivityScreen />);
    fireEvent.press(r.getByText('activity.filter_personal'));

    // `EventRow` compone "descripción · grupo" en un solo nodo de texto; el
    // grupo sintético se traduce a "Personal" (nunca el sentinel crudo).
    expect(r.queryByText(/^Café ·/)).toBeTruthy();
    expect(r.queryByText(/^Café · activity\.filter_personal/)).toBeTruthy();
    expect(r.queryByText(/^Carne ·/)).toBeNull();
  });

  it('"Todos" sigue mostrando ambos', () => {
    const r = render(<ActivityScreen />);
    fireEvent.press(r.getByText('activity.filter_personal'));
    fireEvent.press(r.getByText('activity.filter_all'));

    expect(r.queryByText(/^Café ·/)).toBeTruthy();
    expect(r.queryByText(/^Carne ·/)).toBeTruthy();
  });

  it('el filtro del grupo sigue mostrando sólo lo suyo (no se rompió con el cambio)', () => {
    const r = render(<ActivityScreen />);
    fireEvent.press(r.getByText('Asado'));

    expect(r.queryByText(/^Carne ·/)).toBeTruthy();
    expect(r.queryByText(/^Café ·/)).toBeNull();
  });
});
