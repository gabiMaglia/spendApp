import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { hasRequested } from '@/src/algorithms/deletionRound';
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

describe('borrado consensuado', () => {
  const pedido = (userId: string, at = Date.now()) =>
    ({ userId, votedAt: at, action: 'delete' as const });

  beforeEach(() => {
    useUserStore.setState({ users: [
      { id: 'ua', name: 'Ana' } as User,
      { id: 'ub', name: 'Beto' } as User,
    ]});
    // El diálogo no se puede tocar en un test: se dispara la primera opción con
    // acción, que es "pedir eliminación" (la que abre la ronda).
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, botones) => {
      (botones as { onPress?: () => void }[] | undefined)?.find(b => b.onPress)?.onPress?.();
    });
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('sin solicitud, el creador ve "eliminar gasto"', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ua' })] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.delete_expense')).toBeTruthy();
  });

  it('sin solicitud, quien no es creador ve "pedir eliminación"', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ub' })] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.request_delete')).toBeTruthy();
  });

  // Un aviso que no dice quién ni cuándo no le sirve a nadie para decidir.
  it('el aviso dice quién pidió y cuánto falta', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ub')],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    const aviso = getByText(/delete_pending_body/);

    expect(aviso.props.children).toContain('Beto');
  });

  it('con solicitud ajena, puedo objetar', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ub')],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.object_delete'));

    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.find(v => v.userId === 'ua')?.action).toBe('cancel');
  });

  // Objetar frena a todos; retirar sólo me saca a mí. No son lo mismo y no se
  // pueden ofrecer indistintamente.
  //
  // Lo que cambió con el merge por niveles (T-041 · S7): retirar ya no BORRA mi
  // voto del array —una ausencia vuelve del primer peer que sincronice, con su
  // `votedAt` original y el plazo vencido— sino que emite el mío. Lo que el
  // test exige sigue siendo lo mismo: después de retirar, mi pedido no está.
  it('si el pedido es MÍO, la acción es retirarlo, no objetar', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ua')],
    })] });

    const { getByText, queryByText } = render(<ExpenseDetailScreen />);

    expect(queryByText('expense.object_delete')).toBeNull();
    fireEvent.press(getByText('expense.withdraw_request'));

    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.filter(v => v.action === 'delete')).toHaveLength(0);
    expect(hasRequested(useExpenseStore.getState().expenses[0]!, 'ua')).toBe(false);
  });

  it('ya objetado, se avisa y no se ofrece objetar de nuevo', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ub',
      deletionVotes: [pedido('ub'), { userId: 'ua', votedAt: Date.now(), action: 'cancel' }],
    })] });

    const { getByText, queryByText } = render(<ExpenseDetailScreen />);

    expect(getByText(/delete_objected_title/)).toBeTruthy();
    expect(queryByText('expense.object_delete')).toBeNull();
  });

  // Con una objeción viva, volver a pedir tiene que abrir una ronda LIMPIA: si
  // se acumularan, el cancel viejo bloquearía el pedido nuevo para siempre.
  it('pedir de nuevo después de una objeción limpia los votos viejos', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua',
      deletionVotes: [pedido('ub'), { userId: 'ua', votedAt: Date.now(), action: 'cancel' }],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    // El Alert está mockeado: se dispara la opción de pedir directamente.
    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.every(v => v.action === 'delete')).toBe(true);
    expect(votos).toHaveLength(1);
  });
});
