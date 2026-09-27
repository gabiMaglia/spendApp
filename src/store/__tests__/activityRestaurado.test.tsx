import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useActivityFeed } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import { useAuthStore } from '../authStore';
import { useRestoreExpense } from '@/src/screens/activity/hooks/useRestoreExpense';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * **Restaurar cuenta lo que pasó, no otra cosa** (T-041 · S8, R-Q2 del PO;
 * T-186: sin ronda ni voto, el evento sale de `restoredById`, el campo del
 * «resto» sin firma que T-186 (opción B) agrega para esto).
 *
 * El principio del PO para todo T-041 es «prevenir no es la defensa; ver y
 * poder deshacer, sí» — y un feed que cuenta una historia que no pasó rompe
 * la mitad «ver» justo en el evento donde más importa.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';
const T0 = Date.UTC(2026, 8, 1, 12);

const grupo = (): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splits: [], splitMode: 'equal', category: 'transport',
  date: 5_000, createdAt: 0, createdById: 'ana',
  updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function feed(): ReturnType<typeof useActivityFeed> {
  let out: ReturnType<typeof useActivityFeed> = [];
  function Probe() { out = useActivityFeed(YO); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

const kinds = () => feed().map(e => e.kind);

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [{ id: 'ana', name: 'Ana' }, { id: 'beto', name: 'Beto' }] as never });
});

describe('un gasto restaurado', () => {
  const borrado = gasto({ isDeleted: true, deletedById: 'ana', updatedAt: T0 });
  const restaurado = (): Expense => ({
    ...borrado, isDeleted: false, restoredById: 'beto', updatedAt: T0 + 1_000,
  });

  it('aparece como RESTAURADO', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });
    expect(kinds()).toContain('expense_restored');
  });

  it('dice quién lo restauró', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });
    const ev = feed().find(e => e.kind === 'expense_restored');

    expect(ev).toMatchObject({ restoredByName: 'Beto', groupName: 'Viaje' });
  });

  it('y deja de figurar como borrado', () => {
    useExpenseStore.setState({ expenses: [restaurado()] });
    expect(kinds()).not.toContain('expense_deleted');
  });

  /**
   * Se fecha por cuándo VOLVIÓ, no por la fecha del gasto. Si no, restaurar un
   * gasto viejo lo dejaría enterrado al fondo del feed y nadie se enteraría de
   * que alguien lo devolvió al libro — que es la mitad «ver» del principio del
   * PO, justo en el evento donde más importa.
   */
  it('se ordena por cuándo volvió, no por la fecha del gasto', () => {
    const viejoRestaurado = { ...restaurado(), date: 1, updatedAt: T0 + 1_000 };
    const reciente = gasto({ id: 'e2', description: 'Peaje', date: T0 - 10_000, updatedAt: T0 - 10_000 });
    useExpenseStore.setState({ expenses: [reciente, viejoRestaurado] });

    expect(feed()[0]!.kind).toBe('expense_restored');
  });
});

describe('un gasto borrado sin restaurar', () => {
  it('no genera el evento de restaurado', () => {
    const borrado = gasto({ isDeleted: true, deletedById: 'beto', updatedAt: T0 });
    useExpenseStore.setState({ expenses: [borrado] });

    expect(kinds()).toContain('expense_deleted');
    expect(kinds()).not.toContain('expense_restored');
  });
});

/**
 * T-186 · Task 1 (test nuevo del plan): la integración de punta a punta —
 * cualquier miembro borra al instante desde `updateExpense` y otro miembro
 * restaura con `useRestoreExpense`, sin ronda ni voto — y Actividad muestra
 * quién hizo cada cosa.
 */
describe('T-186: cualquier miembro borra al instante, otro restaura al instante', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [gasto()] });
  });

  it('Beto borra el gasto de Ana, y Actividad lo muestra borrado', () => {
    useExpenseStore.getState().updateExpense('e1', { isDeleted: true, deletedById: 'beto' });

    const gastoBorrado = useExpenseStore.getState().expenses[0]!;
    expect(gastoBorrado.isDeleted).toBe(true);
    expect(gastoBorrado.deletedById).toBe('beto');
    expect(kinds()).toContain('expense_deleted');
  });

  it('Ana restaura lo que borró Beto, y Actividad muestra que fue Ana', () => {
    useExpenseStore.getState().updateExpense('e1', { isDeleted: true, deletedById: 'beto' });

    useAuthStore.setState({ currentUser: { id: 'ana', name: 'Ana' } as User });
    const restaurar = (id: string) => {
      let fn: (expenseId: string) => void = () => {};
      function Probe() { fn = useRestoreExpense({ id: 'ana', name: 'Ana' } as User); return <Text>x</Text>; }
      render(<Probe />);
      fn(id);
    };
    restaurar('e1');

    const restaurado = useExpenseStore.getState().expenses[0]!;
    expect(restaurado.isDeleted).toBe(false);
    expect(restaurado.restoredById).toBe('ana');

    const ev = feed().find(e => e.kind === 'expense_restored');
    expect(ev).toMatchObject({ restoredByName: 'Ana' });
  });
});
