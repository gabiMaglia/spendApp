import React from 'react';
import { render } from '@testing-library/react-native';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { buildGroupPayload } from '@/src/sync/relaySync';
import { applyDelta } from '@/src/sync/useSyncQR';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-185 · Task 3 — diagnóstico. El PO reporta que en su teléfono INVITADO
 * (no el que creó el grupo) el borrado de un gasto ajeno igual pide
 * "solicitud" en un grupo `open`, en vez de borrar al instante. Este test
 * reproduce el camino REAL de punta a punta: «teléfono A» arma el payload
 * con `buildGroupPayload` tal como lo manda el relay, y «teléfono B»
 * (stores vacíos, recién invitado) lo aplica con `applyDelta` — no un
 * `useGroupStore.setState` a mano, que es lo que E1-E4/U1-U3 ya cubren y NO
 * reproduce el bug reportado si el bug está en cómo llega el dato por sync.
 *
 * Si D1 falla, es el bug del PO: hay que reportar la causa exacta
 * (archivo:línea) antes de arreglar, y arreglar en la raíz — no acá.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'e1' }),
}));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-test',
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

function resetStores() {
  useExpenseStore.setState({ expenses: [] });
  useGroupStore.setState({ groups: [] });
  useCommentStore.setState({ comments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
}

describe('D1 · el invitado borra al instante en un grupo `open` recibido por sync', () => {
  it('la acción dice "eliminar gasto", no "solicitar eliminación"', () => {
    // «Teléfono A»: crea el grupo `open` y su gasto, y arma el sobre real.
    useAuthStore.setState({ currentUser: ANA });
    resetStores();
    useGroupStore.setState({ groups: [{
      id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
      deletionMode: 'open', createdAt: 0, createdById: 'ana', deletionVotes: [],
      updatedAt: 0, isDeleted: false,
    } as Group] });
    useExpenseStore.setState({ expenses: [{
      id: 'e1', groupId: 'g1', description: 'Carne', amount: 20_000, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 10_000, isPaid: true },
        { userId: 'beto', amount: 10_000, isPaid: false },
      ],
      category: 'food', date: 0, createdAt: 0, createdById: 'ana',
      deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as Expense] });
    const payload = buildGroupPayload('g1', 'ana');

    // «Teléfono B»: recién invitado, stores vacíos — todo lo que sabe del
    // grupo y del gasto es lo que le llega en ESTE sobre.
    useAuthStore.setState({ currentUser: BETO });
    resetStores();
    useUserStore.setState({ users: [ANA, BETO] });
    applyDelta(payload, 'beto');

    // Confirmación: B ahora conoce el grupo como `open`, aunque él no lo creó.
    const grupoEnB = useGroupStore.getState().getById('g1');
    expect(grupoEnB?.deletionMode).toBe('open');

    const { getByText, queryByText } = render(<ExpenseDetailScreen />);
    expect(getByText('expense.delete_expense')).toBeTruthy();
    expect(queryByText('expense.request_delete')).toBeNull();
  });
});
