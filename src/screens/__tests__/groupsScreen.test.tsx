import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import GroupsScreen from '@/app/(tabs)/groups';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

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

/**
 * **Cambiar de pestaña cambia lo de ABAJO, no lo de arriba** (PO 2026-09-02).
 *
 * El bloque de totales estaba condicionado a que la lista tuviera items, así que
 * al pasar a Archivados —normalmente vacío— desaparecía entero y el segmentado y
 * la lista saltaban hacia arriba. Se lee como si la pantalla se rompiera.
 */
describe('el encabezado no se mueve al cambiar de pestaña', () => {
  it('los totales siguen ahí con la pestaña de archivados vacía', () => {
    const r = render(<GroupsScreen />);
    expect(r.getByText('groups.stat_owed_to_you')).toBeTruthy();

    fireEvent.press(r.getByText('groups.tab_archived'));

    expect(r.getByText('groups.stat_owed_to_you')).toBeTruthy();
    expect(r.getByText('groups.stat_groups')).toBeTruthy();
    // Y la lista de abajo sí cambió: no hay nada archivado.
    expect(r.getByText('groups.empty_archived_title')).toBeTruthy();
  });

  /**
   * El contador cuenta los ACTIVOS, no los visibles. Los dos saldos de al lado
   * son globales y no se mueven: un número que cambia junto a dos que no, se lee
   * como un error de la app.
   */
  it('el contador de grupos no cambia con la pestaña', () => {
    // DOS activos y UNO archivado a propósito: con uno y uno, las dos pestañas
    // dicen «1» y el test pasa igual contando lo visible — que es justo el bug.
    // Lo descubrió una mutación que sobrevivió.
    useGroupStore.setState({
      groups: [grupo('g1', 'Asado'), grupo('g2', 'Viaje'), grupo('g3', 'Finde')],
    });
    useArchiveStore.setState({ archivedIds: ['g3'] });
    const r = render(<GroupsScreen />);

    expect(r.getByText('2')).toBeTruthy();   // dos activos
    fireEvent.press(r.getByText('groups.tab_archived'));
    expect(r.getByText('2')).toBeTruthy();   // sigue diciendo dos, no uno
  });
});

/**
 * **"Total total" al pie de la lista (PO 2026-09-22)**: a diferencia de los
 * cuatro casilleros de arriba (fijos), esto SÍ cambia con la pestaña — es la
 * cuenta separada de lo que se ve ahora: activos o archivados.
 */
describe('"total total" al pie — cambia con la pestaña', () => {
  const conDosMiembros = (id: string): Group => ({
    id, name: id, memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  } as Group);

  /** Ana pagó 10.000 a medias ⇒ Beto le debe 5.000 (Ana en positivo). */
  const gastoAnaPaga = (id: string, groupId: string): Expense => ({
    id, groupId, description: 'x', amount: 1_000_000, currency: 'ARS',
    paidById: 'ana', splitMode: 'equal',
    splits: [
      { userId: 'ana', amount: 500_000, isPaid: true },
      { userId: 'beto', amount: 500_000, isPaid: false },
    ],
    memberIds: ['ana', 'beto'], category: 'other', date: 0, createdAt: 0,
    createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  } as Expense);

  /** Beto pagó 20.000 a medias ⇒ Ana le debe 10.000 (Ana en negativo). */
  const gastoBetoPaga = (id: string, groupId: string): Expense => ({
    id, groupId, description: 'y', amount: 2_000_000, currency: 'ARS',
    paidById: 'beto', splitMode: 'equal',
    splits: [
      { userId: 'ana', amount: 1_000_000, isPaid: false },
      { userId: 'beto', amount: 1_000_000, isPaid: true },
    ],
    memberIds: ['ana', 'beto'], category: 'other', date: 0, createdAt: 0,
    createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  } as Expense);

  it('neta los grupos activos visibles, y cambia al pasar a archivados', () => {
    useGroupStore.setState({ groups: [conDosMiembros('g1'), conDosMiembros('g2')] });
    useArchiveStore.setState({ archivedIds: ['g2'] });
    useExpenseStore.setState({ expenses: [
      gastoAnaPaga('e1', 'g1'),   // activo: +5.000
      gastoBetoPaga('e2', 'g2'),  // archivado: -10.000
    ] });

    // Se lee vía props de `MontoRodante`, no el texto ya animado (T-106/T-109:
    // la primera aparición gira desde una semilla y revela el valor real
    // recién después de un `setTimeout` de escalonado — no es lo que hay que
    // probar acá, que es el CÁLCULO, no la animación).
    const netTotalProps = (r: ReturnType<typeof render>) =>
      r.UNSAFE_getByProps({ id: 'groups.netTotal' }).props;

    const r = render(<GroupsScreen />);
    expect(netTotalProps(r)).toMatchObject({ minor: 500_000, prefix: '' });

    fireEvent.press(r.getByText('groups.tab_archived'));
    expect(netTotalProps(r)).toMatchObject({ minor: -1_000_000, prefix: '-' });
  });
});
