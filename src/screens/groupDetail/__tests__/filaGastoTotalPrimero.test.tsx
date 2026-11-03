import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { ExpenseRow } from '@/src/screens/groupDetail/components/FilasDeTimeline';
import { formatMoney } from '@/src/constants/currencies';
import type { Expense } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/** PO 2026-11-03: en la fila del gasto va primero el total y debajo mi parte. */
const gasto = {
  id: 'e1', groupId: 'g', description: 'Aguas', amount: 3000, currency: 'ARS', paidById: 'ana',
  splits: [{ userId: 'yo', amount: 1000, isPaid: false }, { userId: 'ana', amount: 2000, isPaid: false }],
  splitMode: 'custom', category: 'utilities', date: 1, createdAt: 1, createdById: 'ana', updatedAt: 1, isDeleted: false,
} as Expense;

function textos(ui: ReturnType<typeof render>): string[] {
  return ui.UNSAFE_getAllByType(Text).map(n => [].concat(n.props.children).join(''));
}

describe('ExpenseRow del historial del grupo', () => {
  it('muestra el total del gasto antes que mi parte', () => {
    const ui = render(<ExpenseRow expense={gasto} currentUserId="yo" getUserName={() => 'Ana'} />);
    const t = textos(ui);
    const total = t.findIndex(s => s.includes(formatMoney(3000, 'ARS')));
    const miParte = t.findIndex(s => s.includes(formatMoney(-1000, 'ARS')));
    expect(total).toBeGreaterThanOrEqual(0);
    expect(miParte).toBeGreaterThan(total);
  });
});
