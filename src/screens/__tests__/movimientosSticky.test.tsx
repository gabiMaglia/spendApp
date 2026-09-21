import React from 'react';
import { render } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { User, PersonalEntry } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function entry(id: string, over: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id, kind: 'expense', description: id, amount: 1000, currency: 'ARS',
    category: 'other', date: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    isDeleted: false, ...over,
  } as PersonalEntry;
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * T-121+ (PO 2026-09-20) — "Movimientos" pasa a ser un encabezado pegajoso
 * con el mismo mármol del header, para que la lista no se transparente al
 * pasar por debajo.
 */
describe('encabezado pegajoso de Movimientos', () => {
  it('muestra el título y la cantidad como dos textos separados (space-between)', () => {
    usePersonalStore.setState({
      entries: [entry('e1'), entry('e2')],
      budget: usePersonalStore.getState().budget,
    });

    const r = render(<PersonalScreen />);

    expect(r.getByText('personal.movements_title')).toBeTruthy();
    expect(r.getByText('2')).toBeTruthy();
  });

  it('tiene su propio fondo de mármol, además del que ya trae el header', () => {
    const r = render(<PersonalScreen />);
    // `FondoMarmol` es decorativo (accessibilityElementsHidden) — sin
    // includeHiddenElements RNTL lo excluye por defecto (mismo criterio que
    // CollapsibleHeader.test.tsx). El header ya monta uno; éste es el segundo.
    const todos = r.getAllByTestId('fondo-marmol', { includeHiddenElements: true });
    expect(todos.length).toBeGreaterThanOrEqual(2);
  });

  it('el índice pegajoso del ScrollView apunta al encabezado de Movimientos', () => {
    const r = render(<PersonalScreen />);
    // Comparar el array por referencia (findAllByProps) nunca matchea un
    // literal nuevo — se busca por predicado en su lugar.
    const encontrado = r.UNSAFE_root.findAll(
      (n: { props: Record<string, unknown> }) =>
        Array.isArray(n.props.stickyHeaderIndices) && n.props.stickyHeaderIndices[0] === 1,
    );
    expect(encontrado.length).toBeGreaterThan(0);
  });
});
