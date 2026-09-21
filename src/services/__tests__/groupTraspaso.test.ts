import { traspasarGrupo } from '../groupTraspaso';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, Expense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g-viejo', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: `e-${Math.random()}`, groupId: 'g-viejo', description: 'x', amount: 20_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 10_000, isPaid: false }, { userId: 'ana', amount: 10_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
    ...over,
  } as Expense;
}

beforeEach(() => {
  (['groups', 'expenses', 'payments'] as const).forEach(b => createSecureStorage(b).clearAll());
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({
    // Ana pagó 20.000, se dividió mitad y mitad → Beto le debe 10.000 a Ana.
    expenses: [gasto({ splits: [{ userId: 'beto', amount: 20_000, isPaid: false }] })],
  });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('traspasarGrupo', () => {
  it('crea un grupo nuevo con los mismos miembros y moneda', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(nuevo.memberIds).toEqual(viejo.memberIds);
    expect(nuevo.currency).toBe(viejo.currency);
    expect(nuevo.id).not.toBe(viejo.id);
    expect(useGroupStore.getState().groups.some(g => g.id === nuevo.id)).toBe(true);
  });

  it('crea exactamente un Expense de traspaso en el grupo nuevo, con el balance correcto', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
    expect(delNuevo).toHaveLength(1);
    expect(delNuevo[0].payers).toEqual([{ userId: 'ana', amount: 20_000 }]);
    expect(delNuevo[0].splits).toEqual([{ userId: 'beto', amount: 20_000, isPaid: false }]);
  });

  it('archiva el grupo viejo con reason "limit" (irrevocable)', () => {
    const viejo = useGroupStore.getState().groups[0];
    traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useArchiveStore.getState().isArchived(viejo.id)).toBe(true);
    expect(useArchiveStore.getState().canUnarchive(viejo.id)).toBe(false);
  });

  it('marca el grupo viejo con supersededByGroupId apuntando al nuevo', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const viejoActualizado = useGroupStore.getState().groups.find(g => g.id === viejo.id);
    expect(viejoActualizado?.supersededByGroupId).toBe(nuevo.id);
  });

  it('un grupo ya saldado (balance cero) traspasa sin crear ningún Expense', () => {
    useExpenseStore.setState({ expenses: [] });
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id)).toHaveLength(0);
  });
});
