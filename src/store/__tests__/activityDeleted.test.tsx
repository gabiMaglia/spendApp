import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useActivityFeed } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * Lo BORRADO tiene que verse en Actividad — si no, no hay desde donde
 * restaurarlo.
 *
 * Es la contraparte del modo de borrado LIBRE que el grupo puede elegir: ahi
 * cualquiera borra al instante, y el trato es que cualquiera pueda deshacerlo.
 * Con el feed filtrando `isDeleted`, borrar era irreversible y el trato quedaba
 * a medias. Splitwise resuelve exactamente asi: "undelete in one tap from your
 * recent activity feed".
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';
const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  splitMode: 'equal', category: 'transport', date: 5_000, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function feed(): ReturnType<typeof useActivityFeed> {
  let out: ReturnType<typeof useActivityFeed> = [];
  function Probe() { out = useActivityFeed(YO); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
});

describe('lo borrado sigue visible en Actividad', () => {
  it('un gasto borrado aparece, marcado como borrado', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });
    const evs = feed();
    const borrado = evs.find(e => e.kind === 'expense_deleted');
    expect(borrado).toBeTruthy();
  });

  it('un gasto vivo NO aparece como borrado', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    const evs = feed();
    expect(evs.some(e => e.kind === 'expense_deleted')).toBe(false);
    expect(evs.some(e => e.kind === 'expense_added')).toBe(true);
  });

  it('un gasto borrado NO se cuenta dos veces', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });
    const evs = feed();
    expect(evs.filter(e => 'expense' in e && e.expense.id === 'e1')).toHaveLength(1);
  });

  it('lo borrado de un grupo donde no estoy sigue sin aparecer', () => {
    useGroupStore.setState({ groups: [grupo({ memberIds: ['beto', 'caro'] })] });
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });
    expect(feed()).toHaveLength(0);
  });
});
