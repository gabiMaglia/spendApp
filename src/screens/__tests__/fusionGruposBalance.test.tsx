import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import { router } from 'expo-router';
import type { User, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const GABRIEL = { id: 'gabriel', name: 'Gabriel Maglia' } as User;

function grupo(id: string, memberIds: string[]): Group {
  return {
    id, name: id, memberIds, currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: memberIds[0], deletionVotes: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: GABRIEL });
  useUserStore.setState({ users: [GABRIEL] });
  useGroupStore.setState({ groups: [grupo('asado', ['gabriel', 'ana'])] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * T-121 — la fila "Grupos · Balance" (antes exclusiva de Inicio) vive ahora
 * debajo del resumen ingreso/gasto de Personal, y sigue llevando a Grupos.
 */
describe('fusión Inicio→Personal: fila Grupos · Balance', () => {
  it('muestra la fila y navega a Grupos al tocarla', () => {
    const r = render(<PersonalScreen />);

    const fila = r.getByTestId('groups-balance-row');
    expect(fila).toBeTruthy();

    fireEvent.press(fila);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/groups');
  });

  it('cuenta sólo los grupos donde el usuario es miembro', () => {
    useGroupStore.setState({
      groups: [grupo('asado', ['gabriel', 'ana']), grupo('viaje', ['ana', 'juan'])],
    });

    const r = render(<PersonalScreen />);

    // Con un solo grupo propio, el conteo usa la clave singular
    // (dashboard.groups_count_one, sin opts) — el mock de i18n en
    // src/test-utils/setup.ts devuelve la clave literal, no el texto
    // traducido. El label completo concatena ambas claves con " · ",
    // igual que ya lo hace el patrón probado en ActivityLine.test.tsx.
    expect(r.getByText('dashboard.groups_balance · dashboard.groups_count_one')).toBeTruthy();
  });
});
