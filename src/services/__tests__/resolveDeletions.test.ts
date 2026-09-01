import { resolvePendingDeletions } from '../resolveDeletions';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import { recordServerTime, clearClockOffset } from '@/src/utils/syncedClock';
import type { DeletionVote, Expense, ExpenseComment } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const AHORA = Date.UTC(2026, 7, 17, 12);
const VENCIDO = AHORA + DELETION_TIMEOUT_MS + 1000;

const gasto = (id: string, votes: DeletionVote[], over: Partial<Expense> = {}): Expense => ({
  id, groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pide   = (u: string): DeletionVote => ({ userId: u, votedAt: AHORA, action: 'delete' });
const objeta = (u: string): DeletionVote => ({ userId: u, votedAt: AHORA, action: 'cancel' });

beforeEach(() => {
  useExpenseStore.setState({ expenses: [] });
  useCommentStore.setState({ comments: [] });
});

/**
 * Esto faltaba entero: `resolveDeletionVotes` existía y estaba testeado, pero
 * NO LO LLAMABA NADIE. El plazo de 72hs no vencía nunca y "si nadie objeta se
 * borra" era una promesa que no se cumplía jamás.
 */
describe('vencimiento de las solicitudes de borrado', () => {
  it('pasadas las 72hs sin objeción, se borra', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(1);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('antes de las 72hs NO se borra', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });

    expect(resolvePendingDeletions(AHORA + 71 * 3600_000)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });

  // Objetar es lo que le da sentido a la ventana: si el plazo venciera igual,
  // objetar no serviría de nada.
  it('una objeción lo salva aunque el plazo haya vencido', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto'), objeta('ana')])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });

  it('el creador que fuerza borra al instante', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'ana', votedAt: AHORA, action: 'delete', forced: true },
    ])] });

    expect(resolvePendingDeletions(AHORA)).toBe(1);
  });

  it('los gastos sin solicitud no se tocan', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
  });

  it('un gasto ya borrado no se vuelve a procesar', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')], { isDeleted: true })] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
  });

  // Sin la cascada quedan apuntando a un gasto inexistente y viajan en cada sync.
  it('los comentarios se tombstonean en cascada', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });
    useCommentStore.setState({ comments: [
      { id: 'c1', expenseId: 'e1', authorId: 'beto', text: 'x',
        createdAt: 0, updatedAt: 0, isDeleted: false } as ExpenseComment,
    ]});

    resolvePendingDeletions(VENCIDO);

    expect(useCommentStore.getState().comments[0]!.isDeleted).toBe(true);
  });

  it('procesa varios de una', () => {
    useExpenseStore.setState({ expenses: [
      gasto('e1', [pide('beto')]),
      gasto('e2', [pide('beto')]),
      gasto('e3', []),
    ]});

    expect(resolvePendingDeletions(VENCIDO)).toBe(2);
  });
});

/**
 * **El vencimiento se decide con el reloj corregido, no con el del teléfono**
 * (T-059 · ADR-005).
 *
 * Este es el único lugar donde el reloj llega a borrar un gasto: `resolvePendingDeletions`
 * corre sola en cada arranque y después de cada sync, con el `now` que ella
 * misma se busca. Si ese `now` sale de `Date.now()`, un teléfono con la hora
 * mal puesta borra antes de tiempo o no borra nunca — y nadie ve un error.
 */
describe('el plazo se cuenta contra el reloj corregido', () => {
  afterEach(clearClockOffset);

  it('una hora atrasada no le regala tiempo extra a la solicitud', () => {
    // El teléfono está 2hs atrasado respecto del relay.
    const local = Date.now();
    recordServerTime(new Date(local + 2 * 3_600_000).toISOString(), local);

    // Para el teléfono el pedido tiene 71hs: no vencería. Para la hora real
    // tiene 73hs, y es la que vale.
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'beto', votedAt: local - (DELETION_TIMEOUT_MS - 3_600_000), action: 'delete' },
    ])] });

    expect(resolvePendingDeletions()).toBe(1);
  });

  it('y sin referencia del relay sigue funcionando como siempre', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'beto', votedAt: Date.now() - (DELETION_TIMEOUT_MS - 3_600_000), action: 'delete' },
    ])] });

    expect(resolvePendingDeletions()).toBe(0);
  });
});
