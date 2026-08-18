import React from 'react';
import { render } from '@testing-library/react-native';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import type { Expense, ExpenseComment, User } from '@/src/types/models';

/**
 * La pantalla tiene que ABRIR. Suena obvio y sin embargo estuvo rota: un
 * selector de zustand que armaba un array nuevo en cada render la metía en un
 * loop infinito ("Maximum update depth exceeded") y no había forma de ver un
 * gasto. Ningún test lo agarraba porque nadie renderizaba la pantalla.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'e1' }),
}));

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal',
  splits: [{ userId: 'ua', amount: 10000 }, { userId: 'ub', amount: 10000 }],
  memberIds: ['ua', 'ub'], category: 'food', date: 0, createdAt: 0,
  createdById: 'ua', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: 'ub', text: 'Buenísimo',
  createdAt: 1, updatedAt: 1, isDeleted: false, ...over,
});

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'ua', name: 'Ana' } as User });
  useCommentStore.setState({ comments: [] });
});

describe('detalle del gasto', () => {
  it('abre y muestra el gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    expect(render(<ExpenseDetailScreen />).getByText('Carne')).toBeTruthy();
  });

  it('abre con comentarios cargados', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario()] });

    expect(render(<ExpenseDetailScreen />).getByText('Buenísimo')).toBeTruthy();
  });

  it('no muestra los comentarios de OTRO gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario({ expenseId: 'otro', text: 'Ajeno' })] });

    expect(render(<ExpenseDetailScreen />).queryByText('Ajeno')).toBeNull();
  });

  it('no muestra comentarios borrados', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario({ text: 'Borrado', isDeleted: true })] });

    expect(render(<ExpenseDetailScreen />).queryByText('Borrado')).toBeNull();
  });

  // Un registro que llega por sync puede venir sin campos que acá se recorren.
  // Que falte un dato no puede impedir ABRIR el gasto: sin la pantalla no hay
  // manera de verlo ni de corregirlo.
  it('abre aunque el gasto llegue sin deletionVotes', () => {
    useExpenseStore.setState({ expenses: [gasto({ deletionVotes: undefined as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  it('abre aunque el gasto llegue sin splits', () => {
    useExpenseStore.setState({ expenses: [gasto({ splits: undefined as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  // Las categorías de ingreso son de movimientos personales y no están en el
  // mapa de íconos de gastos.
  it('abre con una categoría fuera del mapa de íconos', () => {
    useExpenseStore.setState({ expenses: [gasto({ category: 'salary' as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  it('un gasto inexistente muestra el vacío, no rompe', () => {
    useExpenseStore.setState({ expenses: [] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.not_found')).toBeTruthy();
  });
});
