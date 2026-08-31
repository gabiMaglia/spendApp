import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useDirectedDebts, useGlobalPersonBalances } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * El bug del PO, como test: dos grupos con la misma persona, deudas opuestas.
 * El modelo viejo las neteaba a cero y saldar volcaba un neto global dentro de
 * un solo grupo. El nuevo conserva las dos.
 */
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const grupo = (id: string): Group => ({
  id, name: id, memberIds: ['yo', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'yo', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

/** Un gasto de 10.000 pagado por `pagador`, dividido en partes iguales. */
const gasto = (id: string, groupId: string, pagador: string): Expense => ({
  id, groupId, description: id, amount: 1_000_000, currency: 'ARS',
  paidById: pagador,
  splits: [{ userId: 'yo', amount: 500_000, isPaid: false }, { userId: 'beto', amount: 500_000, isPaid: false }],
  splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: pagador,
  deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Expense);

function leer<T>(hook: () => T): T {
  let out!: T;
  function Probe() { out = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo('g1'), grupo('g2')] });
  usePaymentStore.setState({ payments: [] });
  // g1: paga Beto  => yo le debo 5.000
  // g2: pago yo    => el me debe 5.000
  useExpenseStore.setState({ expenses: [gasto('e1', 'g1', 'beto'), gasto('e2', 'g2', 'yo')] });
});

describe('deudas opuestas en dos grupos', () => {
  it('el modelo VIEJO las netea a cero — por eso saldar rompia todo', () => {
    const r = leer(() => useGlobalPersonBalances('yo'));
    const beto = r.find(b => b.userId === 'beto');
    expect(beto === undefined || beto.amount === 0).toBe(true);
  });

  it('el modelo DIRECCIONAL conserva las dos', () => {
    const r = leer(() => useDirectedDebts('yo'));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ userId: 'beto', iOwe: 500_000, owesMe: 500_000 });
  });

  it('no cuenta grupos donde no participo', () => {
    useGroupStore.setState({ groups: [{ ...grupo('g1'), memberIds: ['beto', 'caro'] }] });
    expect(leer(() => useDirectedDebts('yo'))).toEqual([]);
  });

  it('un grupo borrado deja de generar deuda', () => {
    useGroupStore.setState({ groups: [{ ...grupo('g1'), isDeleted: true }, grupo('g2')] });
    const r = leer(() => useDirectedDebts('yo'));
    expect(r[0]).toMatchObject({ iOwe: 0, owesMe: 500_000 });
  });

  it('un pago que salda un grupo NO toca la deuda del otro', () => {
    // La direccionalidad, probada de punta a punta: salgo a mano de g1 y g2
    // queda igual.
    usePaymentStore.setState({ payments: [{
      id: 'p1', groupId: 'g1', fromUserId: 'yo', toUserId: 'beto',
      amount: 500_000, currency: 'ARS', date: 0, createdAt: 0, createdById: 'yo',
      updatedAt: 0, isDeleted: false,
    } as never] });
    const r = leer(() => useDirectedDebts('yo'));
    expect(r[0]).toMatchObject({ iOwe: 0, owesMe: 500_000 });
  });
});
