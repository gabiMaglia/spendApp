import React from 'react';
import { render } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/personal';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * **Lo que el resumen de Personal tiene que decir sin que haya que interpretarlo.**
 *
 * El PO preguntó «el box grupos ¿es gastado en grupos?» — y era exactamente el
 * problema: «Grupos» al lado de «Personal» no dice que son GASTOS. Las
 * etiquetas ahora se nombran por lo que son.
 */
describe('el resumen del mes', () => {
  it('los dos gastos dicen que son gastos', () => {
    const r = render(<PersonalScreen />);
    expect(r.getByText('personal.summary_personal')).toBeTruthy();
    expect(r.getByText('personal.summary_groups')).toBeTruthy();
    expect(r.getByText('personal.summary_income')).toBeTruthy();
  });
});

/**
 * **La caja de deuda, con el número que antes había que calcular a mano.**
 *
 * Era un párrafo con los montos embebidos en la frase. El PO pidió una caja, y
 * agregó el dato que faltaba: cuánto queda disponible DESPUÉS de pagar lo que
 * se debe. Ese es el número que decide si podés gastar.
 */
describe('la caja de deudas', () => {
  it('sin deudas no se dibuja', () => {
    const r = render(<PersonalScreen />);
    expect(r.queryByText('personal.i_owe')).toBeNull();
    expect(r.queryByText('personal.available_after_debts')).toBeNull();
    expect(r.queryByText('personal.debts_note')).toBeNull();
  });

  /**
   * La aclaración de ADR-006 sobrevive al párrafo que la contenía: sin ella,
   * los números de arriba parecen no cerrar.
   */
  it('cuando hay deuda, la aclaración sigue estando', () => {
    useGroupStore.setState({ groups: [{
      id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
      createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as never] });
    useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
    useExpenseStore.setState({ expenses: [{
      id: 'e1', groupId: 'g1', description: 'Carne', amount: 100_000, currency: 'ARS',
      paidById: 'beto', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 50_000, isPaid: false },
        { userId: 'beto', amount: 50_000, isPaid: false },
      ],
      memberIds: ['ana', 'beto'], category: 'food', date: Date.now(), createdAt: Date.now(),
      createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as never] });

    const r = render(<PersonalScreen />);
    expect(r.getByText('personal.i_owe')).toBeTruthy();
    expect(r.getByText('personal.available_after_debts')).toBeTruthy();
    expect(r.getByText('personal.debts_note')).toBeTruthy();
  });
});
