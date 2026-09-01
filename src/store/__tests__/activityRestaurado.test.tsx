import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useActivityFeed } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import { emitirVoto } from '@/src/services/deletionVotes';
import type { Expense, Group } from '@/src/types/models';

/**
 * **Restaurar cuenta lo que pasó, no otra cosa** (T-041 · S8, R-Q2 del PO).
 *
 * Antes de S8 restaurar y objetar escribían el mismo voto, así que el que
 * devolvía un gasto al libro figuraba como si se hubiera opuesto a algo. El
 * principio del PO para todo T-041 es «prevenir no es la defensa; ver y poder
 * deshacer, sí» — y un feed que cuenta una historia que no pasó rompe la mitad
 * «ver» justo en el evento donde más importa.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';
const T0 = Date.UTC(2026, 8, 1, 12);

const grupo = (): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splits: [], splitMode: 'equal', category: 'transport',
  date: 5_000, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function feed(): ReturnType<typeof useActivityFeed> {
  let out: ReturnType<typeof useActivityFeed> = [];
  function Probe() { out = useActivityFeed(YO); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

const kinds = () => feed().map(e => e.kind);

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [{ id: 'beto', name: 'Beto' }] as never });
});

describe('un gasto restaurado', () => {
  const borrado = gasto({
    isDeleted: true, updatedAt: T0,
    deletionVotes: emitirVoto(gasto(), 'ana', 'force', T0),
  });
  const restaurado = (): Expense => ({
    ...borrado, isDeleted: false, updatedAt: T0 + 1_000,
    deletionVotes: emitirVoto(borrado, 'beto', 'restore', T0 + 1_000),
  });

  it('aparece como RESTAURADO, no como objetado ni como pedido de borrado', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });

    expect(kinds()).toContain('expense_restored');
    expect(kinds()).not.toContain('expense_delete_request');
  });

  it('dice quién lo restauró', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });
    const ev = feed().find(e => e.kind === 'expense_restored');

    expect(ev).toMatchObject({ restoredByName: 'Beto', groupName: 'Viaje' });
  });

  it('y deja de figurar como borrado', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });
    expect(kinds()).not.toContain('expense_deleted');
  });

  /**
   * Se fecha por cuándo VOLVIÓ, no por la fecha del gasto. Si no, restaurar un
   * gasto viejo lo dejaría enterrado al fondo del feed y nadie se enteraría de
   * que alguien lo devolvió al libro — que es la mitad «ver» del principio del
   * PO, justo en el evento donde más importa.
   */
  it('se ordena por cuándo volvió, no por la fecha del gasto', () => {
    const viejoRestaurado = { ...restaurado(), date: 1, updatedAt: T0 + 1_000 };
    const reciente = gasto({ id: 'e2', description: 'Peaje', date: T0 - 10_000, updatedAt: T0 - 10_000 });
    useExpenseStore.setState({ expenses: [reciente, viejoRestaurado] });

    expect(feed()[0]!.kind).toBe('expense_restored');
  });
});

describe('una objeción NO es una restauración', () => {
  it('objetar un pedido no genera el evento de restaurado', () => {
    const pedido = gasto({ deletionVotes: emitirVoto(gasto(), 'beto', 'delete', T0) });
    const objetado = { ...pedido, deletionVotes: emitirVoto(pedido, 'ana', 'object', T0 + 1_000) };
    useExpenseStore.setState({ expenses: [objetado] });

    expect(kinds()).not.toContain('expense_restored');
    expect(kinds()).not.toContain('expense_delete_request');
  });
});

describe('un pedido vivo sigue avisando', () => {
  it('el pedido de borrado abierto no se confunde con nada de esto', () => {
    useExpenseStore.setState({
      expenses: [gasto({ deletionVotes: emitirVoto(gasto(), 'beto', 'delete', T0) })],
    });

    expect(kinds()).toContain('expense_delete_request');
    expect(kinds()).not.toContain('expense_restored');
  });
});
