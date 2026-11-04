import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { usePersonalStore } from '@/src/store/personalStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useAuthStore } from '@/src/store/authStore';
import type { PersonalEntry, User } from '@/src/types/models';

/** T-257: editar una entrada personal con la pantalla de gasto existente. */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), startRelay: jest.fn(), deviceId: () => 'dev' }));
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: (...a: unknown[]) => mockBack(...a), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const entry = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'p1', kind: 'expense', description: 'Café', amount: 1500, currency: 'USD',
  category: 'food', date: Date.UTC(2026, 0, 10), createdAt: 5, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

describe.each(['default', 'aero'] as const)('editar entrada personal (skin %s)', skin => {
  beforeEach(() => {
    mockBack.mockClear();
    mockParams = { personalEntryId: 'p1' };
    useAuthStore.setState({ currentUser: { id: 'u' } as User });
    useSettingsStore.setState({ skin, displayCurrency: 'ARS', lastPersonalCurrency: 'CLP' });
    usePersonalStore.setState({ entries: [entry()] });
  });

  it('precarga descripción y moneda de la entrada, con título de edición', () => {
    const r = render(<NewExpenseScreen />);
    expect(r.getByDisplayValue('Café')).toBeTruthy();
    expect(r.getByText('expense.edit_title')).toBeTruthy();
    expect(r.queryByText('expense.new_title')).toBeNull();
    expect(r.getAllByText(/USD/).length).toBeGreaterThan(0);
  });

  it('guardar actualiza la misma entrada y no crea otra', () => {
    const r = render(<NewExpenseScreen />);
    fireEvent.changeText(r.getByDisplayValue('Café'), 'Cena');
    fireEvent.press(r.getByTestId('expense-save-btn'));
    const es = usePersonalStore.getState().entries;
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ id: 'p1', description: 'Cena', currency: 'USD' });
    expect(mockBack).toHaveBeenCalled();
  });

  it('un ingreso se edita con su título', () => {
    usePersonalStore.setState({ entries: [entry({ kind: 'income', category: 'other' })] });
    const r = render(<NewExpenseScreen />);
    expect(r.getByText('expense.edit_income_title')).toBeTruthy();
  });

  it('no ofrece pasar la entrada a un grupo', () => {
    const r = render(<NewExpenseScreen />);
    const chip = r.queryByText('expense.no_group_short');
    if (chip) fireEvent.press(chip);
    expect(r.queryByText('expense.select_group')).toBeNull();
  });

  it('una entrada derivada no abre edición: queda el formulario de alta', () => {
    usePersonalStore.setState({ entries: [entry({ kind: 'group_replicated' })] });
    const r = render(<NewExpenseScreen />);
    expect(r.getByText('expense.new_title')).toBeTruthy();
  });
});
