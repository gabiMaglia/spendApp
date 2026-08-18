import { usePaymentStore } from '../paymentStore';
import { useCommentStore } from '../commentStore';
import { useExpenseStore } from '../expenseStore';
import { schedulePublish } from '@/src/sync/relayEngine';
import type { Expense, ExpenseComment, Payment } from '@/src/types/models';

/**
 * Todo lo que cambia el estado de un grupo tiene que publicarse.
 *
 * Los gastos ya lo hacían; los pagos y los comentarios no, y el síntoma era
 * silencioso y feo: saldás una deuda, vos ves tu saldo en cero y el otro te
 * sigue reclamando hasta que algo ajeno dispare una publicación.
 */

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-test',
}));

const publish = schedulePublish as jest.Mock;

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ua', toUserId: 'ub',
  amount: 1000, currency: 'ARS', date: 0,
  updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal', splits: [], memberIds: ['ua'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ua', deletionVotes: [],
  updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: 'ua', text: 'hola',
  createdAt: 0, updatedAt: 0, isDeleted: false, ...over,
});

beforeEach(() => {
  publish.mockClear();
  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: [] });
  useExpenseStore.setState({ expenses: [gasto()] });
});

describe('pagos', () => {
  it('saldar una deuda se publica', () => {
    usePaymentStore.getState().addPayment(pago());
    expect(publish).toHaveBeenCalledWith('g1');
  });

  it('editar un pago también', () => {
    usePaymentStore.setState({ payments: [pago()] });
    usePaymentStore.getState().updatePayment('p1', { amount: 500 });
    expect(publish).toHaveBeenCalledWith('g1');
  });

  it('un pago sin grupo no se publica', () => {
    usePaymentStore.getState().addPayment(pago({ groupId: '' }));
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('comentarios', () => {
  it('comentar se publica en el grupo del gasto', () => {
    useCommentStore.getState().addComment(comentario());
    expect(publish).toHaveBeenCalledWith('g1');
  });

  it('borrar un comentario también', () => {
    useCommentStore.setState({ comments: [comentario()] });
    useCommentStore.getState().removeComment('c1');
    expect(publish).toHaveBeenCalledWith('g1');
  });

  it('la cascada al borrar el gasto se publica', () => {
    useCommentStore.setState({ comments: [comentario()] });
    useCommentStore.getState().removeForExpense('e1');
    expect(publish).toHaveBeenCalledWith('g1');
  });

  // Un comentario cuelga del gasto, no del grupo: si el gasto es personal no
  // hay grupo al que publicar.
  it('un comentario de un movimiento personal no se publica', () => {
    useExpenseStore.setState({ expenses: [gasto({ groupId: '' })] });
    useCommentStore.getState().addComment(comentario());
    expect(publish).not.toHaveBeenCalled();
  });
});
