import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { User, Group, Expense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function grupo(): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
  };
}

function gastos(n: number): Expense[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`, groupId: 'g1', description: `g${i}`, amount: 1_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 1_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
  }));
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('aviso y botón de traspaso en el detalle del grupo', () => {
  it('con menos de 350 gastos, no muestra el aviso', () => {
    useExpenseStore.setState({ expenses: gastos(349) });
    const r = render(<GroupDetailScreen />);
    expect(r.queryByTestId('traspaso-banner')).toBeNull();
  });

  it('con 350 gastos o más, muestra el aviso de traspaso', () => {
    useExpenseStore.setState({ expenses: gastos(350) });
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('traspaso-banner')).toBeTruthy();
  });

  it('el botón "Traspasar a grupo nuevo" está siempre disponible, aunque haya pocos gastos', () => {
    useExpenseStore.setState({ expenses: gastos(2) });
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('traspaso-manual-btn')).toBeTruthy();
  });

  it('tocar el botón manual y confirmar crea el grupo nuevo y archiva el viejo', () => {
    useExpenseStore.setState({ expenses: gastos(2) });
    const r = render(<GroupDetailScreen />);

    fireEvent.press(r.getByTestId('traspaso-manual-btn'));
    fireEvent.press(r.getByTestId('traspaso-confirmar-btn'));

    const grupos = useGroupStore.getState().groups;
    expect(grupos).toHaveLength(2);
    expect(grupos.find(g => g.id === 'g1')?.supersededByGroupId).toBeDefined();
  });

  // Minor de la revisión final: un grupo YA archivado no puede ofrecer un
  // traspaso nuevo — re-traspasarlo pisaría su `supersededByGroupId` y
  // produciría un duplicado.
  it('con el grupo ya archivado, ni el aviso ni el botón manual aparecen', () => {
    useExpenseStore.setState({ expenses: gastos(400) });
    useArchiveStore.getState().setArchived('g1', true, 'limit');

    const r = render(<GroupDetailScreen />);
    expect(r.queryByTestId('traspaso-banner')).toBeNull();
    expect(r.queryByTestId('traspaso-manual-btn')).toBeNull();
  });
});
