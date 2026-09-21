import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { User, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ groupId: 'g1' }),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function grupo(id: string): Group {
  return {
    id, name: id, memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
  } as Group;
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
  useGroupStore.setState({ groups: [grupo('g1')] });
  useExpenseStore.setState({ expenses: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('un grupo archivado no acepta gastos nuevos', () => {
  it('con el grupo archivado, el botón de guardar queda deshabilitado', () => {
    useArchiveStore.getState().setArchived('g1', true);

    const r = render(<NewExpenseScreen />);
    fireEvent.changeText(r.getByPlaceholderText('expense.description_placeholder'), 'Cena');
    fireEvent.changeText(r.getByTestId('expense-amount'), '10');

    const guardar = r.getByTestId('expense-save-btn');
    expect(guardar.props.accessibilityState?.disabled ?? guardar.props.disabled).toBe(true);
  });

  it('sin archivar, el botón de guardar se habilita normalmente con datos válidos', () => {
    const r = render(<NewExpenseScreen />);
    fireEvent.changeText(r.getByPlaceholderText('expense.description_placeholder'), 'Cena');
    fireEvent.changeText(r.getByTestId('expense-amount'), '10');

    const guardar = r.getByTestId('expense-save-btn');
    expect(guardar.props.accessibilityState?.disabled ?? guardar.props.disabled).toBeFalsy();
  });
});
