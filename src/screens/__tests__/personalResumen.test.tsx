import React from 'react';
import { render, within } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { User, Group } from '@/src/types/models';

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
 * **Cantidad de grupos al lado de Ingreso** (PO 2026-09-20, reemplaza la
 * fila "Grupos · Balance" que vivía debajo de este resumen).
 */
describe('indicador de cantidad de grupos junto al ingreso', () => {
  function grupo(id: string, memberIds: string[]): Group {
    return {
      id, name: id, memberIds, currency: 'ARS',
      createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
      createdById: memberIds[0], deletionVotes: [],
    };
  }

  it('sin grupos propios, muestra 0', () => {
    const r = render(<PersonalScreen />);
    const celda = within(r.getByTestId('stat-lead-right'));
    expect(celda.getByText('tabs.groups')).toBeTruthy();
    expect(celda.getByText('0')).toBeTruthy();
  });

  it('cuenta sólo los grupos donde el usuario es miembro', () => {
    useGroupStore.setState({
      groups: [grupo('asado', ['ana', 'beto']), grupo('viaje', ['beto', 'carla'])],
    });

    const r = render(<PersonalScreen />);

    expect(within(r.getByTestId('stat-lead-right')).getByText('1')).toBeTruthy();
  });

  it('la fila "Grupos · Balance" ya no existe', () => {
    const r = render(<PersonalScreen />);
    expect(r.queryByTestId('groups-balance-row')).toBeNull();
  });
});

/**
 * **La caja de deuda, con el número que antes había que calcular a mano.**
 *
 * Era un párrafo con los montos embebidos en la frase. El PO pidió una caja
 * con el dato que faltaba: cuánto queda disponible DESPUÉS de pagar lo que se
 * debe. Ese es el único número nuevo acá — "te deben"/"debés" YA se muestran
 * en el primer bloque, pegado al header, y repetirlos acá era la misma info
 * dos veces (T-137, pedido del PO). Sin deuda propia no hay nada que saldar,
 * así que esta caja directamente no se dibuja.
 */
describe('la caja de deudas', () => {
  it('sin deudas no se dibuja', () => {
    const r = render(<PersonalScreen />);
    expect(r.queryByText('personal.available_after_debts')).toBeNull();
  });

  /**
   * La leyenda de ADR-006 ("no afecta lo gastado hasta que se salde") se sacó
   * (PO 2026-09-22): el PO la consideró ruido, no aclaración — "te deben"/
   * "debés" NO se repiten acá — ya están en el bloque de arriba del todo.
   */
  it('cuando hay deuda propia, muestra el disponible tras saldar — sin repetir "debés"', () => {
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
    expect(r.getByText('personal.available_after_debts')).toBeTruthy();
    expect(r.queryByText('personal.i_owe')).toBeNull();
  });

  /**
   * El número tiene que quedar NEGATIVO (con el "-") cuando pagar lo que
   * debés te deja en rojo — antes `Math.abs()` se comía el signo y un monto
   * en rojo se leía como si fuera positivo.
   */
  it('si pagar la deuda te deja en negativo, el monto lleva el signo "-"', () => {
    useGroupStore.setState({ groups: [{
      id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
      createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as never] });
    useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
    // Ana debe $1.000 (100_000 en unidad menor) y no tiene presupuesto ni
    // ingresos: "disponible" parte de $0, así que tras saldar queda en -$1.000.
    useExpenseStore.setState({ expenses: [{
      id: 'e1', groupId: 'g1', description: 'Viaje', amount: 200_000, currency: 'ARS',
      paidById: 'beto', splitMode: 'equal',
      splits: [
        { userId: 'ana', amount: 100_000, isPaid: false },
        { userId: 'beto', amount: 100_000, isPaid: false },
      ],
      memberIds: ['ana', 'beto'], category: 'food', date: Date.now(), createdAt: Date.now(),
      createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
    } as never] });

    const r = render(<PersonalScreen />);
    expect(r.getByText('-$1.000')).toBeTruthy();
  });

  /**
   * Con deuda en las DOS direcciones a la vez: "disponible tras saldar" tiene
   * que cobrar lo que te deben Y pagar lo que debés, no sólo restar `youOwe`
   * — antes ignoraba por completo lo que te debían a vos.
   */
  it('con deuda en las dos direcciones, neta las dos (te deben $5.000, debés $10.000 → -$5.000)', () => {
    useGroupStore.setState({
      groups: [
        {
          id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
          createdAt: 0, createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
        },
        {
          id: 'g2', name: 'Viaje', memberIds: ['ana', 'carla'], currency: 'ARS',
          createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
        },
      ] as never,
    });
    useUserStore.setState({
      users: [ANA, { id: 'beto', name: 'Beto' } as User, { id: 'carla', name: 'Carla' } as User],
    });
    useExpenseStore.setState({
      expenses: [
        // Ana debe $10.000 (beto pagó, split parejo de 2, cada mitad $10.000).
        {
          id: 'e1', groupId: 'g1', description: 'Asado', amount: 2_000_000, currency: 'ARS',
          paidById: 'beto', splitMode: 'equal',
          splits: [
            { userId: 'ana', amount: 1_000_000, isPaid: false },
            { userId: 'beto', amount: 1_000_000, isPaid: false },
          ],
          memberIds: ['ana', 'beto'], category: 'food', date: Date.now(), createdAt: Date.now(),
          createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false,
        },
        // A Ana le deben $5.000 (ana pagó, split parejo de 2, cada mitad $5.000).
        {
          id: 'e2', groupId: 'g2', description: 'Viaje', amount: 1_000_000, currency: 'ARS',
          paidById: 'ana', splitMode: 'equal',
          splits: [
            { userId: 'ana', amount: 500_000, isPaid: false },
            { userId: 'carla', amount: 500_000, isPaid: false },
          ],
          memberIds: ['ana', 'carla'], category: 'food', date: Date.now(), createdAt: Date.now(),
          createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
        },
      ] as never,
    });

    const r = render(<PersonalScreen />);
    expect(r.getByText('-$5.000')).toBeTruthy();
  });
});
