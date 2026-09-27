import { useCommentStore } from '../commentStore';
import { syncedNow } from '@/src/utils/syncedClock';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';
import type { ExpenseComment } from '@/src/types/models';

/**
 * T-144 (SEC-02), defecto D1 del verifier (`engram/qa/T-144-verifier.md`).
 *
 * `removeForExpense` (la cascada al borrar un gasto) estampaba `updatedAt: now`
 * a secas, sin pasar por `siguienteUpdatedAt`. Un comentario cuyo `updatedAt`
 * ya venía adelantado (pero todavía plausible, dentro de `TOLERANCIA_RELOJ_MS`)
 * terminaba con un tombstone cuyo `updatedAt` era MENOR que el que tenía antes
 * de tombstonearse: el próximo merge —con un peer, o con el propio device al
 * recibir su propio sobre viejo— ve un `updatedAt` mayor en la versión viva y
 * la resucita para siempre, porque nada vuelve a llamar a la cascada.
 *
 * `syncedNow()` se mockea para poder fijar "ahora" y comparar contra un previo
 * elegido a mano, sin depender de que dos llamadas caigan en el mismo ms.
 */
jest.mock('@/src/utils/syncedClock', () => ({ syncedNow: jest.fn() }));
const mockedSyncedNow = syncedNow as jest.Mock;

const NOW = 1_790_000_000_000;

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: 'ua', text: 'Che, esto lo pagué yo',
  createdAt: 1_000, updatedAt: 1_000, isDeleted: false, ...over,
});

beforeEach(() => {
  mockedSyncedNow.mockReturnValue(NOW);
  useCommentStore.setState({ comments: [], isLoading: false });
});

describe('removeForExpense — la cascada no pierde el LWW contra su propio comentario', () => {
  it('un comentario con updatedAt adelantado (dentro de tolerancia) recibe una estampa MAYOR que la que tenía', () => {
    const previo = NOW + TOLERANCIA_RELOJ_MS - 1_000; // plausible: no envenenado, pero adelantado
    useCommentStore.setState({ comments: [comentario({ updatedAt: previo })] });

    useCommentStore.getState().removeForExpense('e1');

    const c = useCommentStore.getState().comments[0]!;
    expect(c.isDeleted).toBe(true);
    // Si esto no se cumple, un `updatedAt` vivo mayor le gana al tombstone en
    // cualquier merge posterior y la cascada queda deshecha para siempre.
    expect(c.updatedAt).toBeGreaterThan(previo);
  });

  it('varios comentarios del mismo gasto, cada uno con su propio adelanto, sanan todos', () => {
    useCommentStore.setState({
      comments: [
        comentario({ id: 'c1', updatedAt: NOW + 60_000 }),
        comentario({ id: 'c2', updatedAt: NOW + 120_000 }),
      ],
    });

    useCommentStore.getState().removeForExpense('e1');

    const [c1, c2] = useCommentStore.getState().comments;
    expect(c1!.updatedAt).toBeGreaterThan(NOW + 60_000);
    expect(c2!.updatedAt).toBeGreaterThan(NOW + 120_000);
  });
});
