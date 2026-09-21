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

  it('la fila "Grupos · Balance" queda después del StatLead y antes del bloque de deuda de Personal', () => {
    // Misma forma de sembrar una deuda real que
    // personalResumen.test.tsx#"cuando hay deuda, la aclaración sigue estando":
    // un grupo + un gasto pagado por otro miembro con un split sin pagar para
    // el usuario actual, así `personal.i_owe` (que sólo aparece con `youOwe >
    // 0`) realmente renderiza y sirve de marcador de posición.
    useUserStore.setState({ users: [GABRIEL, { id: 'ana', name: 'Ana' } as User] });
    useExpenseStore.setState({ expenses: [{
      id: 'e1', groupId: 'asado', description: 'Carne', amount: 100_000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal',
      splits: [
        { userId: 'gabriel', amount: 50_000, isPaid: false },
        { userId: 'ana', amount: 50_000, isPaid: false },
      ],
      memberIds: ['gabriel', 'ana'], category: 'food', date: Date.now(), createdAt: Date.now(),
      createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as never] });

    const r = render(<PersonalScreen />);

    // getByTestId/getByText no dan posición, pero el árbol serializado sí
    // conserva el orden real de renderizado (mismo patrón que
    // fusionHeaderYDeudas.test.tsx).
    const arbol = JSON.stringify(r.toJSON());
    const indiceFila = arbol.indexOf('groups-balance-row');
    const indiceDeuda = arbol.indexOf('personal.i_owe');

    expect(indiceFila).toBeGreaterThanOrEqual(0);
    expect(indiceDeuda).toBeGreaterThan(indiceFila);
  });
});
