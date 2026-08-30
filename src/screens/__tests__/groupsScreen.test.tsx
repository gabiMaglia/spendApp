import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import GroupsScreen from '@/app/(tabs)/groups';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const ANA = { id: 'ana', name: 'Ana' } as User;

const grupo = (id: string, name: string): Group => ({
  id, name, memberIds: ['ana'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [grupo('g1', 'Asado'), grupo('g2', 'Viaje')] });
  useArchiveStore.setState({ archivedIds: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
});

describe('un solo punto de entrada para crear grupo', () => {
  // Había tres: el "+" de arriba, el del estado vacío (que no hacía NADA) y el
  // FAB. Tres botones para lo mismo y uno muerto.
  it('el FAB navega a crear grupo', () => {
    // El "+" del encabezado se fue: crear grupo vive solo en el FAB, como en
    // el resto de las tabs (PO 2026-08-30). Se busca por testID y no por
    // posición, que era frágil ante cualquier reordenamiento.
    const { getByTestId } = render(<GroupsScreen />);
    fireEvent.press(getByTestId('new-group'));

    const { router } = jest.requireMock('expo-router');
    expect(router.push).toHaveBeenCalledWith('/groups/new');
  });

  it('hay UN solo punto de entrada, tambien con la lista vacia', () => {
    // Antes habia tres (el "+" del encabezado, uno muerto en el estado vacio y
    // el FAB). La asercion se vuelve mas exigente, no mas laxa: no basta con
    // que no haya uno muerto, tiene que haber exactamente UNO.
    useGroupStore.setState({ groups: [] });

    const { getAllByText } = render(<GroupsScreen />);
    expect(getAllByText('groups.new_group')).toHaveLength(1);
  });
});

describe('archivar', () => {
  it('los archivados salen de la lista principal', () => {
    useArchiveStore.setState({ archivedIds: ['g1'] });

    const { queryByText, getByText } = render(<GroupsScreen />);

    expect(queryByText('Asado')).toBeNull();
    expect(getByText('Viaje')).toBeTruthy();
  });

  it('la pestaña Archivados los muestra', () => {
    useArchiveStore.setState({ archivedIds: ['g1'] });

    const { getByText, queryByText } = render(<GroupsScreen />);
    fireEvent.press(getByText('groups.tab_archived'));

    expect(getByText('Asado')).toBeTruthy();
    expect(queryByText('Viaje')).toBeNull();
  });

  // Archivar no es borrar: el grupo sigue existiendo con todo lo suyo.
  it('archivar no borra el grupo', () => {
    useArchiveStore.getState().setArchived('g1', true);

    expect(useGroupStore.getState().getById('g1')?.isDeleted).toBe(false);
  });

  it('sin nada archivado, la pestaña lo dice', () => {
    const { getByText } = render(<GroupsScreen />);
    fireEvent.press(getByText('groups.tab_archived'));

    expect(getByText('groups.empty_archived_title')).toBeTruthy();
  });
});
