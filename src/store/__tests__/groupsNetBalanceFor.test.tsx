import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useGroupsNetBalanceFor } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * `useGroupsNetBalanceFor` — el "total total" al pie de la lista de Grupos
 * (PO 2026-09-22). A diferencia de `useGroupsTotalBalance` (siempre excluye
 * archivados), acá el conjunto de grupos lo elige quien llama: sirve para
 * "activos" Y para "archivados" según la pestaña.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [
    { userId: 'ana', amount: 500_000, isPaid: true },
    { userId: 'beto', amount: 500_000, isPaid: false },
  ],
  memberIds: ['ana', 'beto'], category: 'transport', date: 0, createdAt: 0,
  createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function usar<T>(hook: () => T): T {
  let salida!: T;
  function Probe() { salida = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return salida;
}

beforeEach(() => {
  useUserStore.setState({ users: [
    { id: 'ana', name: 'Ana' } as User, { id: 'beto', name: 'Beto' } as User,
  ] });
  usePaymentStore.setState({ payments: [] });
});

describe('useGroupsNetBalanceFor', () => {
  it('neta te-deben y debés de UN grupo incluido', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const saldos = usar(() => useGroupsNetBalanceFor(YO, new Set(['g1'])));

    expect(saldos).toEqual([{ currency: 'ARS', net: 500_000 }]);
  });

  it('un grupo que no está en el conjunto no suma', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const saldos = usar(() => useGroupsNetBalanceFor(YO, new Set(['otro-grupo'])));

    expect(saldos).toEqual([]);
  });

  it('suma varios grupos del mismo conjunto en la misma moneda', () => {
    useGroupStore.setState({ groups: [
      grupo({ id: 'g1' }),
      grupo({ id: 'g2', name: 'Depto' }),
    ] });
    useExpenseStore.setState({ expenses: [
      gasto({ id: 'e1', groupId: 'g1' }),
      gasto({ id: 'e2', groupId: 'g2' }),
    ] });

    const saldos = usar(() => useGroupsNetBalanceFor(YO, new Set(['g1', 'g2'])));

    expect(saldos).toEqual([{ currency: 'ARS', net: 1_000_000 }]);
  });

  it('un grupo BORRADO en el conjunto no cuenta', () => {
    useGroupStore.setState({ groups: [grupo({ isDeleted: true })] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const saldos = usar(() => useGroupsNetBalanceFor(YO, new Set(['g1'])));

    expect(saldos).toEqual([]);
  });

  it('sin ningún grupo en el conjunto, devuelve vacío', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gasto()] });

    const saldos = usar(() => useGroupsNetBalanceFor(YO, new Set()));

    expect(saldos).toEqual([]);
  });
});
