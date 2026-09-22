import React from 'react';
import { render } from '@testing-library/react-native';
import ActivityScreen from '@/app/(tabs)/activity';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import type { PersonalEntry, User } from '@/src/types/models';
import { Colors } from '@/src/constants/colors';

/**
 * PO 2026-09-22: los gastos/ingresos cargados desde la tab Personal (un
 * `PersonalEntry`, no un `Expense`) no aparecían en Actividad. Este test
 * cubre que SE VEAN en pantalla, no sólo que el selector los incluya.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const AHORA = 1_800_000_000_000;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
});

describe('Actividad muestra los PersonalEntry de la tab Personal', () => {
  it('un gasto personal cargado desde Personal se ve en Actividad', () => {
    const entry: PersonalEntry = {
      id: 'pe1', kind: 'expense', description: 'Supermercado', amount: 12_000, currency: 'ARS',
      category: 'other', date: AHORA, createdAt: AHORA, updatedAt: AHORA, isDeleted: false,
    };
    usePersonalStore.setState({ entries: [entry] });

    const r = render(<ActivityScreen />);

    expect(r.getByText('Supermercado')).toBeTruthy();
    expect(r.getByText('$120')).toBeTruthy();
  });

  it('un ingreso personal se ve en verde', () => {
    const entry: PersonalEntry = {
      id: 'pe2', kind: 'income', description: 'Sueldo', amount: 500_000, currency: 'ARS',
      category: 'salary', date: AHORA, createdAt: AHORA, updatedAt: AHORA, isDeleted: false,
    };
    usePersonalStore.setState({ entries: [entry] });

    const r = render(<ActivityScreen />);

    const monto = r.getByText('$5.000');
    expect(monto.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: Colors.light.semantic.positive })]),
    );
  });
});
