import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { EntryRow } from '../EntryRow';
import type { PersonalEntry } from '@/src/types/models';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const entry = (over: Partial<PersonalEntry>): PersonalEntry => ({
  id: 'e1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

beforeEach(() => mockPush.mockClear());

describe('tocar una fila de Personal (T-257)', () => {
  it.each(['expense', 'income'] as const)('una entrada manual (%s) abre la edición con su id', kind => {
    const { getByText } = render(<EntryRow entry={entry({ kind })} onRemove={jest.fn()} />);
    fireEvent.press(getByText('Café'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/expense/new', params: { personalEntryId: 'e1' } });
  });

  it.each(['group_replicated', 'carryover'] as const)('una derivada (%s) no navega', kind => {
    const { getByText } = render(<EntryRow entry={entry({ kind, description: 'Derivada' })} onRemove={jest.fn()} />);
    fireEvent.press(getByText('Derivada'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each(['payment_out', 'payment_in'] as const)('un pago (%s) no navega', kind => {
    const { getByText } = render(<EntryRow entry={entry({ kind })} onRemove={jest.fn()} />);
    fireEvent.press(getByText(/personal\.payment_/));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
