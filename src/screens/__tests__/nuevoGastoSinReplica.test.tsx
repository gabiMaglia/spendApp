import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User, Group } from '@/src/types/models';

/**
 * T-229 (ADR-006 d3): lo que puse en un gasto de grupo se DERIVA en Personal
 * (`movimientosDerivados`). Nuevo gasto ya no guarda una réplica: si la
 * guardara, habría dos fuentes que se desincronizan al editar o borrar.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ groupId: 'g1', allowIncome: '1' }),
}));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  announceGroupToContacts: jest.fn(),
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-1',
}));

const USER = { id: 'ua', name: 'Ana' } as User;
const GROUP: Group = {
  id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
  miembros: {}, createdAt: 0, createdById: 'ua', updatedAt: 0, isDeleted: false,
};

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: USER, isPro: false });
  useGroupStore.setState({ groups: [GROUP] });
  useExpenseStore.setState({ expenses: [] });
  usePersonalStore.setState({ entries: [] });
  useUserStore.setState({ users: [] });
  useGroupKeyStore.setState({ keys: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => { jest.restoreAllMocks(); });

it('guardar un gasto de grupo NO escribe en personalStore: Personal lo deriva (T-229)', () => {
  const { getByPlaceholderText, getByText } = render(<NewExpenseScreen />);
  fireEvent.changeText(getByPlaceholderText('expense.description_placeholder'), 'Cena');
  fireEvent.changeText(getByPlaceholderText('0'), '1000');
  fireEvent.press(getByText('expense.save'));

  expect(useExpenseStore.getState().expenses).toHaveLength(1);
  expect(usePersonalStore.getState().entries).toEqual([]);
});
