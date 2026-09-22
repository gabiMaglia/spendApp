import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useGroupBalance } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * **PO 2026-09-22, rendimiento en gama baja.** `useGroupBalance` se llama UNA
 * VEZ POR FILA en una lista de grupos. Antes traía `s.expenses` ENTERO sin
 * filtrar en el selector: agregar un gasto en el grupo A hacía que la fila
 * del grupo B (que no cambió en nada) también re-renderizara y volviera a
 * correr `calculateBalancesByCurrency` — el costo escalaba con el store
 * entero, no con lo que de verdad cambió. Este test cubre el CONTRATO de
 * rendimiento, no sólo el resultado: cuántas veces se ejecuta el hook.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const grupoA: Group = {
  id: 'gA', name: 'Grupo A', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

const grupoB: Group = {
  id: 'gB', name: 'Grupo B', memberIds: ['ana', 'caro'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

const gastoDeA: Expense = {
  id: 'eA1', groupId: 'gA', description: 'Nafta', amount: 100_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [
    { userId: 'ana', amount: 50_000, isPaid: true },
    { userId: 'beto', amount: 50_000, isPaid: false },
  ],
  memberIds: ['ana', 'beto'], category: 'transport', date: 0, createdAt: 0,
  createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Expense;

beforeEach(() => {
  useGroupStore.setState({ groups: [grupoA, grupoB] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
});

describe('useGroupBalance no se recalcula por gastos de OTRO grupo', () => {
  it('una fila del grupo B no re-renderiza cuando se agrega un gasto al grupo A', () => {
    let rendersB = 0;
    function ProbeB() {
      rendersB += 1;
      useGroupBalance('gB', 'ana');
      return <Text>b</Text>;
    }
    render(<ProbeB />);
    expect(rendersB).toBe(1);

    act(() => {
      useExpenseStore.setState({ expenses: [gastoDeA] });
    });

    // El store de expenses cambió (referencia nueva del array), pero el
    // SUBCONJUNTO del grupo B sigue siendo exactamente el mismo (vacío) —
    // `useShallow` no debería disparar un re-render acá.
    expect(rendersB).toBe(1);
  });

  it('una fila del grupo A sí re-renderiza cuando se le agrega un gasto propio', () => {
    let rendersA = 0;
    let ultimoBalance: number | undefined;
    function ProbeA() {
      rendersA += 1;
      const balances = useGroupBalance('gA', 'ana');
      ultimoBalance = balances.find(b => b.currency === 'ARS')?.amount;
      return <Text>a</Text>;
    }
    render(<ProbeA />);
    expect(rendersA).toBe(1);
    expect(ultimoBalance).toBeUndefined();

    act(() => {
      useExpenseStore.setState({ expenses: [gastoDeA] });
    });

    expect(rendersA).toBeGreaterThan(1);
    expect(ultimoBalance).toBe(50_000); // Ana pagó $1.000, Beto le debe $500
  });
});
