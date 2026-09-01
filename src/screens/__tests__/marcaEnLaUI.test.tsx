import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ed25519 } from '@noble/curves/ed25519.js';
import GroupDetailScreen from '@/app/groups/[id]';
import ActivityScreen from '@/app/(tabs)/activity';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { signCore } from '@/src/sync/recordSign';
import { signVote } from '@/src/sync/voteSign';
import { toHex } from '@/src/sync/hexBytes';
import { clearVerdictCache } from '@/src/sync/verdictCache';
import {
  forgetAuthorKeys, reloadAuthorKeys, rememberAuthorKey, __resetAuthorSources,
} from '@/src/sync/authorKeys';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { DeletionVote, Expense, Group, Payment, User } from '@/src/types/models';

/**
 * **La marca, donde el usuario la ve** (T-041 · S10).
 *
 * Hasta acá la app firmaba cada registro, los verificaba, los contaba y los
 * medía — y no le mostraba nada a nadie. La R1 del PO pide tres cosas de un
 * registro que no verifica: **se MUESTRA, SUMA al balance, y queda MARCADO**.
 * Las dos primeras están desde S6; ésta es la tercera.
 *
 * Y la invariante que no se negocia: **nunca bloquea, nunca esconde**. Si un
 * test demuestra que un registro dejó de mostrarse o dejó de sumar por no
 * verificar, S10 está mal.
 *
 * Los tests mockean `t()` para que devuelva la clave, así que se afirma sobre
 * `trust.*` y no sobre el copy — el copy en los tres idiomas lo cubre
 * `src/i18n/__tests__/trustCopy.test.ts`.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('@/src/sync/contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('@/src/sync/deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));
/**
 * Las tres pantallas leen el id de la ruta. Se comparte una sola variable para
 * poder montar la de grupo y la de detalle en el mismo archivo.
 */
let mockIdDeRuta = 'g1';
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: mockIdDeRuta }),
}));

const PRIV = toHex(new Uint8Array(32).fill(41));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(41)));

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 100_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 50_000 }, { userId: 'beto', amount: 50_000 }],
  splitMode: 'equal', category: 'transport', date: 1_000, createdAt: 1_000,
  createdById: 'ana', deletionVotes: [], rev: 1_000, updatedAt: 1_000, isDeleted: false, ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 20_000,
  currency: 'ARS', date: 2_000, createdAt: 2_000, createdById: 'beto',
  rev: 1_000, updatedAt: 2_000, isDeleted: false, ...over,
} as Payment);

/** El mismo gasto, firmado de verdad por Ana, con su clave ya conocida. */
function gastoFirmado(over: Partial<Expense> = {}): Expense {
  const g = gasto(over);
  return { ...g, ...signCore('expense', g as never, PRIV) } as Expense;
}

/** Corre la cola de verificación entera: cada paso agenda el siguiente. */
const laColaEntera = (tope = 30) => {
  for (let i = 0; i < tope; i++) act(() => { jest.advanceTimersToNextTimer(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  clearVerdictCache();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  rememberAuthorKey('ana', PUB);

  useAuthStore.setState({ currentUser: { id: 'beto', name: 'Beto' } as User });
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: [] });
  useUserStore.setState({ users: [] });
});

afterEach(() => { jest.useRealTimers(); });

describe('la marca en la lista del grupo', () => {
  it('un gasto sin firma queda marcado', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const { queryAllByText } = render(<GroupDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge').length).toBe(1);
  });

  /**
   * La otra causa de R1: hay firma y no cierra. **Una sola marca, dos causas**
   * (decisión 2 del PO): al usuario le dicen lo mismo —mirá el gasto— y la
   * medición interna las separa siempre, que es lo que no se negocia.
   */
  it('un gasto cuya firma no cierra queda marcado igual', () => {
    // Firmado por Ana y después alterado: la firma es real y el núcleo ya no.
    useExpenseStore.setState({ expenses: [{ ...gastoFirmado(), amount: 999_999 }] });

    const { queryAllByText } = render(<GroupDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge').length).toBe(1);
  });

  /** Si todo lleva marca, la marca no dice nada. */
  it('un gasto que verifica NO lleva marca', () => {
    useExpenseStore.setState({ expenses: [gastoFirmado()] });

    const { queryAllByText } = render(<GroupDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge')).toEqual([]);
  });

  it('un pago sin firma queda marcado', () => {
    usePaymentStore.setState({ payments: [pago()] });

    const { queryAllByText } = render(<GroupDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge').length).toBe(1);
  });

  /**
   * **La invariante de S6 y S7, mirada desde la pantalla.** Marcar no puede
   * esconder ni restar: el gasto sigue en la lista y el balance sigue contando
   * exactamente lo mismo que contaba antes de que existiera la marca.
   */
  it('el gasto marcado se sigue mostrando y sigue sumando al balance', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const { getByText, getAllByText, queryAllByText } = render(<GroupDetailScreen />);
    laColaEntera();

    expect(getByText('Nafta')).toBeTruthy();
    expect(queryAllByText('trust.badge').length).toBe(1);

    // El balance que la PANTALLA muestra, no el que calcularía un algoritmo al
    // costado: lo que hay que probar es que la marca no le restó nada a lo que
    // el usuario ve. Beto no puso nada y le tocan 500,00 de los 1.000,00 de Ana.
    expect(getAllByText(/500,00/).length).toBeGreaterThan(0);
    expect(getByText('group_detail.you_owe_short')).toBeTruthy();
  });

  /**
   * Antes de que la cola llegue a la fila no se afirma nada: ni marca ni visto
   * bueno. Es la consecuencia visible de D8 —se verifica sólo lo que se está
   * mirando— y es la dirección correcta del error: acusar por no haber mirado
   * todavía sería el mismo defecto que D2 cerró en la medición.
   */
  it('mientras la cola no llegó, la fila no dice nada', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const { getByText, queryAllByText } = render(<GroupDetailScreen />);

    expect(getByText('Nafta')).toBeTruthy();
    expect(queryAllByText('trust.badge')).toEqual([]);
  });
});

describe('la marca en el feed de actividad', () => {
  /** R1, textual: el registro que no verifica **salta en el feed**. */
  it('un gasto sin firma salta marcado en el feed', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const { queryAllByText } = render(<ActivityScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge').length).toBe(1);
  });

  it('un pago sin firma salta marcado en el feed', () => {
    usePaymentStore.setState({ payments: [pago()] });

    const { queryAllByText } = render(<ActivityScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge').length).toBe(1);
  });

  it('un gasto que verifica no ensucia el feed con una marca', () => {
    useExpenseStore.setState({ expenses: [gastoFirmado()] });

    const { queryAllByText } = render(<ActivityScreen />);
    laColaEntera();

    expect(queryAllByText('trust.badge')).toEqual([]);
  });

  /**
   * **Cada fila lleva la marca de LA FIRMA QUE LA SOSTIENE.** La fila de un
   * pedido de borrado no habla del gasto: habla del enunciado de quien lo pidió,
   * y lo firma otra persona. Marcarla con el veredicto del gasto sería mostrar
   * el resultado de haber verificado otra cosa.
   *
   * El caso está armado para que las dos respuestas se vean distintas: el gasto
   * verifica y el voto no.
   */
  it('la fila del pedido de borrado se marca por el voto, no por el gasto', () => {
    useExpenseStore.setState({
      expenses: [gastoFirmado({
        deletionVotes: [{ userId: 'ana', votedAt: 3_000, action: 'delete', roundId: 'r1' }],
      })],
    });

    const { getByTestId, queryByTestId } = render(<ActivityScreen />);
    laColaEntera();

    expect(getByTestId('trust-expense_delete_request')).toBeTruthy();
    expect(queryByTestId('trust-expense_added')).toBeNull();
  });

  /** Y al revés: con el pedido firmado por su autor, la fila queda limpia. */
  it('el pedido firmado por su autor no marca su fila', () => {
    const v = { userId: 'ana' as const, votedAt: 3_000, action: 'delete' as const, roundId: 'r1' };
    useExpenseStore.setState({
      expenses: [gastoFirmado({ deletionVotes: [{ ...v, ...signVote('e1', v, PRIV) }] })],
    });

    const { queryByTestId } = render(<ActivityScreen />);
    laColaEntera();

    expect(queryByTestId('trust-expense_delete_request')).toBeNull();
  });

  /**
   * El feed sigue contando lo que pasó: la marca se suma a la fila, no la
   * reemplaza ni agrega un evento aparte. Un evento nuevo duplicaría la fila del
   * mismo gasto —«agregado» y «no verificado»— y R1 pide que aparezca *como
   * cualquier gasto*, marcado.
   */
  it('la fila marcada sigue siendo la fila del gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const { getAllByText, queryAllByText } = render(<ActivityScreen />);
    laColaEntera();

    expect(getAllByText(/Nafta/).length).toBe(1);
    expect(queryAllByText('trust.badge').length).toBe(1);
  });
});

describe('la marca en el detalle del gasto, y la de los votos', () => {
  beforeEach(() => { mockIdDeRuta = 'e1'; });
  afterEach(() => { mockIdDeRuta = 'g1'; });

  const voto = (over: Partial<DeletionVote> = {}): DeletionVote => ({
    userId: 'ana', votedAt: 3_000, action: 'delete', roundId: 'r1', ...over,
  });

  const votoFirmado = (over: Partial<DeletionVote> = {}): DeletionVote => {
    const v = voto(over);
    return { ...v, ...signVote('e1', v, PRIV) };
  };

  it('el gasto sin firma queda marcado en su detalle', () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e1' })] });

    const { queryAllByText } = render(<ExpenseDetailScreen />);
    laColaEntera();

    // En el detalle va el aviso largo: es la pantalla a la que la marca de la
    // lista manda a mirar, y acá sí hay lugar para decir qué pasó.
    expect(queryAllByText('trust.expense').length).toBe(1);
  });

  /**
   * **El llamador de producción de `verifyVote` (S8), que hasta acá no tenía
   * ninguno.** El `forced` del creador se honra SIEMPRE (R3) y el pedido de
   * borrado también: lo único que agrega S10 es la atribución — quién lo pidió,
   * y si esa firma verificó.
   */
  it('un pedido de borrado sin firma queda marcado', () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e1', deletionVotes: [voto()] })] });

    const { queryAllByText } = render(<ExpenseDetailScreen />);
    laColaEntera();

    // Dos avisos distintos, porque son dos firmas distintas de dos personas
    // distintas: el núcleo del gasto y el enunciado del voto.
    expect(queryAllByText('trust.expense').length).toBe(1);
    expect(queryAllByText('trust.vote').length).toBe(1);
  });

  it('un pedido de borrado firmado por su autor NO lleva marca', () => {
    useExpenseStore.setState({
      expenses: [gastoFirmado({ id: 'e1', deletionVotes: [votoFirmado()] })],
    });

    const { queryAllByText } = render(<ExpenseDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.expense')).toEqual([]);
    expect(queryAllByText('trust.vote')).toEqual([]);
  });

  /**
   * Un voto que dice ser de Beto y lo firmó la clave de Ana. Beto tiene clave
   * conocida y no es ésa, así que la firma **no cierra** — no es falta de
   * información. Con una sola marca el usuario ve lo mismo que ante un voto sin
   * firma —mirá el gasto—, que es exactamente lo que el PO pidió; la medición
   * interna sí los separa.
   */
  it('un pedido de borrado firmado por otro queda marcado', () => {
    rememberAuthorKey('beto', toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7))));
    const ajeno = voto({ userId: 'beto' });

    useExpenseStore.setState({
      expenses: [gastoFirmado({
        id: 'e1',
        deletionVotes: [{ ...ajeno, ...signVote('e1', ajeno, PRIV) }],
      })],
    });

    const { queryAllByText } = render(<ExpenseDetailScreen />);
    laColaEntera();

    expect(queryAllByText('trust.expense')).toEqual([]);   // el gasto sí verifica
    expect(queryAllByText('trust.vote').length).toBe(1);
  });

  /** Nunca bloquea: el pedido de borrado marcado se sigue contando. */
  it('el pedido marcado sigue abriendo la ronda', () => {
    useExpenseStore.setState({ expenses: [gasto({ id: 'e1', deletionVotes: [voto()] })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    laColaEntera();

    expect(getByText(/expense\.delete_pending_title/)).toBeTruthy();
  });
});
