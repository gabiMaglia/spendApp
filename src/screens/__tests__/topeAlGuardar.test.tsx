import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NewExpenseScreen from '@/app/expense/new';
import NewGroupScreen from '@/app/groups/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User, Group, Expense } from '@/src/types/models';

/**
 * T-178 (6.4): el mismo predicado que hoy sólo corre al publicar/recibir
 * (`excesoDe`) tiene que correr TAMBIÉN antes de escribir en el store desde
 * el formulario — si no, el registro queda huérfano en el teléfono de quien
 * lo creó, sin viajar nunca y sin que nadie se entere. La nota/nombre
 * gigante se inyecta directo en el evento de texto (no hay forma honesta de
 * pasar el `maxLength` del input real) para simular el caso límite.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const mockRouterBack = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));
jest.mock('@/src/sync/relayEngine', () => ({
  announceGroupToContacts: jest.fn(),
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-1',
}));

const USER = { id: 'ua', name: 'Ana' } as User;
const GROUP: Group = {
  id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  createdAt: 0, createdById: 'ua', deletionVotes: [], updatedAt: 0, isDeleted: false,
};
const NOTA_GIGANTE = 'x'.repeat(300_000);

beforeEach(() => {
  mockSearchParams = {};
  mockRouterBack.mockReset();
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

describe('T-178 — el registro que excede el tope no se guarda (gate al escribir)', () => {
  it('R2 (gasto nuevo): nota gigante → Alert y addExpense NO se llama', () => {
    mockSearchParams = { groupId: 'g1', allowIncome: '1' };
    const addExpense = jest.fn();
    useExpenseStore.setState({ addExpense });
    const { getByPlaceholderText, getByText, getByTestId } = render(<NewExpenseScreen />);

    fireEvent.changeText(getByPlaceholderText('expense.description_placeholder'), 'Cena');
    fireEvent.changeText(getByPlaceholderText('0'), '100');
    // Abre el editor de nota e inyecta el texto gigante.
    fireEvent.press(getByText('expense.note'));
    fireEvent.changeText(getByPlaceholderText('expense.note_placeholder'), NOTA_GIGANTE);
    fireEvent.press(getByText('common.done'));
    fireEvent.press(getByText('expense.save'));

    expect(addExpense).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('sync.record_too_big_title', 'sync.record_too_big_bytes');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('R4 (edición de gasto existente): nota gigante → Alert, updateExpense NO se llama, el gasto queda como estaba', () => {
    const EXPENSE: Expense = {
      id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
      paidById: 'ua', createdById: 'ua',
      splits: [
        { userId: 'ua', amount: 5_000, isPaid: true },
        { userId: 'ub', amount: 5_000, isPaid: false },
      ],
      splitMode: 'equal', category: 'food', date: 1_000, createdAt: 1_000,
      updatedAt: 1_000, isDeleted: false, deletionVotes: [],
    };
    mockSearchParams = { expenseId: 'e1' };
    const updateExpense = jest.fn(() => true);
    useExpenseStore.setState({ expenses: [EXPENSE], updateExpense });
    const { getByText, getByPlaceholderText } = render(<NewExpenseScreen />);

    fireEvent.press(getByText('expense.note'));
    fireEvent.changeText(getByPlaceholderText('expense.note_placeholder'), NOTA_GIGANTE);
    fireEvent.press(getByText('common.done'));
    fireEvent.press(getByText('expense.save'));

    expect(updateExpense).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('sync.record_too_big_title', 'sync.record_too_big_bytes');
    expect(mockRouterBack).not.toHaveBeenCalled();
    // El gasto local no cambió.
    expect(useExpenseStore.getState().expenses[0]).toEqual(EXPENSE);
  });

  it('R1 (control): un gasto normal se guarda igual que antes', () => {
    mockSearchParams = { groupId: 'g1', allowIncome: '1' };
    const addExpense = jest.fn();
    useExpenseStore.setState({ addExpense });
    const { getByPlaceholderText, getByText } = render(<NewExpenseScreen />);

    fireEvent.changeText(getByPlaceholderText('expense.description_placeholder'), 'Cena');
    fireEvent.changeText(getByPlaceholderText('0'), '100');
    fireEvent.press(getByText('expense.save'));

    expect(addExpense).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('grupo con nombre gigante inyectado → Alert y addGroup NO se llama', () => {
    useUserStore.setState({ users: [{ id: 'ub', name: 'Beto', isDeleted: false } as User] });
    const { getByPlaceholderText, getByText } = render(<NewGroupScreen />);

    fireEvent.press(getByText('Beto'));
    fireEvent.changeText(getByPlaceholderText('groups.name_placeholder'), NOTA_GIGANTE);
    fireEvent.press(getByText('common.create'));

    expect(useGroupStore.getState().groups).toHaveLength(1); // sigue sólo GROUP, no se agregó
    expect(Alert.alert).toHaveBeenCalledWith('sync.record_too_big_title', 'sync.record_too_big_bytes');
  });

  it('R5: un registro legado que ya excedía el tope, guardado antes de este cambio, no se toca al leer el store', () => {
    // La puerta es sólo al escribir desde un formulario — el store en sí no
    // filtra lo que ya tiene adentro (T-178, fila R5).
    const legado: Expense = {
      id: 'e-legado', groupId: 'g1', description: 'x', amount: 1,
      currency: 'ARS', paidById: 'ua', createdById: 'ua',
      splits: [{ userId: 'ua', amount: 1, isPaid: true }],
      splitMode: 'equal', category: 'other', date: 1, createdAt: 1,
      note: NOTA_GIGANTE, updatedAt: 1, isDeleted: false, deletionVotes: [],
    };
    useExpenseStore.setState({ expenses: [legado] });
    expect(useExpenseStore.getState().expenses).toEqual([legado]);
  });
});
