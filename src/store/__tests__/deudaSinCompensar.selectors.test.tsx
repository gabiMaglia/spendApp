import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  useDirectedDebts, useGlobalPersonBalances, useGroupsTotalBalance, useTotalesDelGrupo,
} from '@/src/store/selectors';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { Expense, Group, Payment } from '@/src/types/models';

/**
 * T-225 — el caso del PO en el Moto (2026-09-29): un grupo con Ana, cuatro
 * gastos donde me deben 200 y uno donde debo 60. Antes se veía «Te deben 140 ·
 * Debés 0»; ahora cada lado por separado, en todas las pantallas.
 */
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const grupo = (id: string, memberIds = ['yo', 'ana']): Group => ({
  id, name: id, memberIds, currency: 'ARS', miembros: {},
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false,
} as Group);

let n = 0;
const gasto = (groupId: string, pagador: string, amount: number, partes: Record<string, number>): Expense => {
  n++;
  return {
    id: `e${n}`, groupId, description: 'x', amount, currency: 'ARS', paidById: pagador,
    splits: Object.entries(partes).map(([userId, a]) => ({ userId, amount: a, isPaid: false })),
    splitMode: 'custom', category: 'food', date: n, createdAt: n, createdById: pagador, updatedAt: n, isDeleted: false,
  } as Expense;
};
const pago = (groupId: string, from: string, to: string, amount: number): Payment => {
  n++;
  return {
    id: `p${n}`, groupId, fromUserId: from, toUserId: to, amount, currency: 'ARS',
    date: n, createdAt: n, createdById: from, updatedAt: n, isDeleted: false,
  } as Payment;
};

function leer<T>(hook: () => T): T {
  let out!: T;
  function Probe() { out = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

const casoDelPO = () => [
  gasto('g', 'yo', 100, { yo: 50, ana: 50 }),
  gasto('g', 'yo', 100, { yo: 50, ana: 50 }),
  gasto('g', 'yo', 100, { yo: 50, ana: 50 }),
  gasto('g', 'yo', 100, { yo: 50, ana: 50 }),
  gasto('g', 'ana', 120, { yo: 60, ana: 60 }),
];

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo('g')] });
  useExpenseStore.setState({ expenses: casoDelPO() });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [] });
});

describe('T-225 — Te deben / Debés sin compensar', () => {
  it('Grupos: te deben 200 y debés 60 (antes 140 y 0)', () => {
    expect(leer(() => useGroupsTotalBalance('yo'))).toEqual([{ currency: 'ARS', owedToYou: 200, youOwe: 60 }]);
  });

  it('detalle de grupo: los totales de ESE grupo', () => {
    useGroupStore.setState({ groups: [grupo('g'), grupo('otro')] });
    useExpenseStore.setState({ expenses: [...casoDelPO(), gasto('otro', 'ana', 40, { yo: 20, ana: 20 })] });
    expect(leer(() => useTotalesDelGrupo('g', 'yo'))).toEqual([{ currency: 'ARS', owedToYou: 200, youOwe: 60 }]);
    expect(leer(() => useTotalesDelGrupo('otro', 'yo'))).toEqual([{ currency: 'ARS', owedToYou: 0, youOwe: 20 }]);
  });

  it('Personal: la deuda con Ana tiene los dos lados', () => {
    const r = leer(() => useDirectedDebts('yo'));
    expect(r).toEqual([{ userId: 'ana', currency: 'ARS', owesMe: 200, iOwe: 60 }]);
  });

  it('Amigos: la tarjeta de Ana muestra el neto (me debe − le debo)', () => {
    expect(leer(() => useGlobalPersonBalances('yo'))).toEqual([{ userId: 'ana', currency: 'ARS', amount: 140 }]);
  });

  it('si pago mis 60, debo 0 y me siguen debiendo 200', () => {
    usePaymentStore.setState({ payments: [pago('g', 'yo', 'ana', 60)] });
    expect(leer(() => useGroupsTotalBalance('yo'))).toEqual([{ currency: 'ARS', owedToYou: 200, youOwe: 0 }]);
  });

  it('entre grupos también se suma sin compensar', () => {
    useGroupStore.setState({ groups: [grupo('g'), grupo('g2')] });
    useExpenseStore.setState({ expenses: [...casoDelPO(), gasto('g2', 'ana', 60, { yo: 30, ana: 30 })] });
    expect(leer(() => useDirectedDebts('yo'))).toEqual([{ userId: 'ana', currency: 'ARS', owesMe: 200, iOwe: 90 }]);
    expect(leer(() => useGlobalPersonBalances('yo'))).toEqual([{ userId: 'ana', currency: 'ARS', amount: 110 }]);
  });

  it('un grupo archivado no suma', () => {
    useArchiveStore.setState({ archivedIds: ['g'] });
    expect(leer(() => useGroupsTotalBalance('yo'))).toEqual([]);
    expect(leer(() => useDirectedDebts('yo'))).toEqual([]);
  });

  it('con todo saldado de los dos lados no queda nada', () => {
    usePaymentStore.setState({ payments: [pago('g', 'yo', 'ana', 60), pago('g', 'ana', 'yo', 200)] });
    expect(leer(() => useGroupsTotalBalance('yo'))).toEqual([]);
    expect(leer(() => useGlobalPersonBalances('yo'))).toEqual([]);
  });
});
