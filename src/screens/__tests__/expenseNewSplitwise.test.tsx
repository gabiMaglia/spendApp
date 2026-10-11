import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Group, User } from '@/src/types/models';

/**
 * feat/reskin (PO 2026-10-11, variante «B4»): en Aero el alta de gasto toma la
 * estructura de Splitwise. Arriba sólo lo esencial —con quién, categoría,
 * descripción y monto—; pagador y reparto se leen en una frase («Pagado por
 * vos y dividido en partes iguales») y se editan en hojas. Repetir, foto y
 * nota van en la barra de abajo. Clásico no cambia (T-210).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockSearchParams: Record<string, string | undefined> = { groupId: 'g1' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {},
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  mockSearchParams = { groupId: 'g1' };
  useAuthStore.setState({ currentUser: ANA, isPro: false });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
  useSettingsStore.setState({ skin: 'aero' });
});

describe('Alta de gasto estilo Splitwise (Aero)', () => {
  it('muestra «Con vos y» con el grupo, y la frase con pagador y reparto', () => {
    const r = render(<NewExpenseScreen />);
    expect(r.getByTestId('con-quien')).toHaveTextContent(/Asado/);
    expect(r.getByTestId('frase-pagador')).toHaveTextContent('expense.you');
    expect(r.getByTestId('frase-reparto')).toHaveTextContent('expense.phrase_equally');
  });

  it('el reparto no está abierto en el formulario: se abre desde la frase', () => {
    const r = render(<NewExpenseScreen />);
    expect(r.queryByText('expense.split_mode_percentage')).toBeNull();
    fireEvent.press(r.getByTestId('frase-reparto'));
    fireEvent.press(r.getByText('expense.split_mode_percentage'));
    expect(r.getByTestId('frase-reparto')).toHaveTextContent('expense.phrase_percentage');
  });

  it('la hoja del pagador elige a otro miembro y permite «Pagaron varios»', () => {
    const r = render(<NewExpenseScreen />);
    fireEvent.press(r.getByTestId('frase-pagador'));
    fireEvent.press(r.getByText('Beto'));
    expect(r.getByTestId('frase-pagador')).toHaveTextContent('Beto');

    fireEvent.press(r.getByTestId('frase-pagador'));
    expect(r.queryByText('payers.title')).toBeNull();
    fireEvent.press(r.getByText('payers.multiple'));
    expect(r.getByText('payers.title')).toBeTruthy();
    expect(r.getByTestId('frase-pagador')).toHaveTextContent('expense.phrase_several');
  });

  it('Repetir no está en el formulario: se abre desde la barra', () => {
    const r = render(<NewExpenseScreen />);
    expect(r.queryByText('recurrence.weekly')).toBeNull();
    fireEvent.press(r.getByTestId('barra-repetir'));
    fireEvent.press(r.getByText('recurrence.weekly'));
    expect(within(r.getByTestId('barra-repetir')).getByText('recurrence.weekly')).toBeTruthy();
  });

  it('gasto personal (sin grupo): «Con vos y» dice sin grupo y no hay frase', () => {
    mockSearchParams = {};
    const r = render(<NewExpenseScreen />);
    expect(r.getByTestId('con-quien')).toHaveTextContent(/expense\.no_group_short/);
    expect(r.queryByTestId('frase-pagador')).toBeNull();
  });

  it('ingreso desde Personal: selector arriba, sin «Con vos y», sin categorías ni frase', () => {
    mockSearchParams = { allowIncome: '1', kind: 'income' };
    const r = render(<NewExpenseScreen />);
    expect(r.getByText('expense.kind_income')).toBeTruthy();
    expect(r.queryByTestId('con-quien')).toBeNull();
    expect(r.queryByText('categories.food')).toBeNull();
    expect(r.queryByTestId('frase-pagador')).toBeNull();
    fireEvent.press(r.getByText('expense.kind_expense'));
    expect(r.getByText('categories.food')).toBeTruthy();
  });

  it('Clásico conserva su formulario (T-210)', () => {
    useSettingsStore.setState({ skin: 'default' });
    const r = render(<NewExpenseScreen />);
    expect(r.getByTestId('tarjeta-pago')).toBeTruthy();
    expect(r.queryByTestId('frase-pagador')).toBeNull();
  });
});
