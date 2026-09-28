/**
 * T-194 — dos dispositivos: devA comenta un gasto compartido con devB; al
 * drenar, devB tiene que enterarse. Antes de este fix `Snapshot`/`noticesFor`
 * (`src/services/syncNotices.ts`) no miraban `comments`, así que
 * `avisarDeLoNuevo` (`src/sync/relay/drain.ts`) nunca podía producir un aviso
 * de comentario — el dato llegaba y se veía en la pantalla del gasto, pero no
 * pasaba nada más.
 *
 * Mismo patrón que `drainSnapshotPerezoso.test.ts`: buzón real en memoria,
 * `drainGroup`/`applyDelta` sin mockear, y `notifications.announce` envuelto
 * en `jest.fn(actual.announce)` — sigue siendo el `announce` real (escribe en
 * la bandeja de verdad), sólo que espiable.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});

// Diagnóstico de autoría fuera de banda: no relevante acá (mismo motivo que
// en `drainSnapshotPerezoso.test.ts`).
jest.mock('../authorHealth', () => ({
  observeAuthor: jest.fn(async () => 'ok'),
  RECHAZAR_AUTORES_NO_VERIFICADOS: false,
}));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

// `announce` REAL, envuelto para poder ver CON QUÉ se lo llamó — no se
// reemplaza por un stub: la bandeja (`useNoticeInboxStore`) tiene que quedar
// escrita de verdad, que es justo lo que el PO pidió ver.
jest.mock('@/src/services/notifications', () => {
  const actual = jest.requireActual('@/src/services/notifications') as typeof import('@/src/services/notifications');
  return { ...actual, announce: jest.fn(actual.announce) };
});

import { drainNow } from '../relayEngine';
import { publishToGroup } from '../relaySync';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { marcarPendienteDeDrenaje, limpiarPendienteDeDrenaje } from '../pendingDrain';
import type { Group, Expense, ExpenseComment, User } from '@/src/types/models';

const mockAnnounce = jest.requireMock('@/src/services/notifications').announce as jest.Mock;

const DEV_A = 'devA';
const DEV_B = 'devB';

function grupo(): Group {
  return {
    id: 'G', name: 'Asado', memberIds: [DEV_A, DEV_B], currency: 'ARS',
    miembros: {}, createdAt: 1, createdById: DEV_A, updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(): Expense {
  return {
    id: 'e1', groupId: 'G', description: 'Carne', amount: 20_000, currency: 'ARS',
    paidById: DEV_A, splits: [{ userId: DEV_A, amount: 10_000, isPaid: false }, { userId: DEV_B, amount: 10_000, isPaid: false }],
    splitMode: 'equal', category: 'food', date: 1, createdAt: 1, createdById: DEV_A, updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

/**
 * Publica el estado de A (grupo + gasto + comentarios) como si fuera devA, y
 * DEVUELVE el store local a como estaba (la perspectiva de devB) — mismo
 * truco que `publicarGastoDeOtro` en `drainSnapshotPerezoso.test.ts`: este
 * proceso hace de las DOS puntas, pero cada una tiene que ver sólo lo suyo.
 * Sin restaurar, el comentario de A ya estaría "puesto" localmente antes de
 * drenar y el test no probaría nada — `noticesFor` lo vería como conocido.
 */
async function publicarComoA(comments: ExpenseComment[]): Promise<void> {
  const antesUsuario = useAuthStore.getState().currentUser;
  const antesGroups = useGroupStore.getState().groups;
  const antesExpenses = useExpenseStore.getState().expenses;
  const antesComments = useCommentStore.getState().comments;

  useAuthStore.setState({ currentUser: { id: DEV_A } as User } as never);
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [gasto()] } as never);
  useCommentStore.setState({ comments } as never);
  const r = await publishToGroup('G', DEV_A, 'device-A');
  expect(r.ok).toBe(true);

  useAuthStore.setState({ currentUser: antesUsuario } as never);
  useGroupStore.setState({ groups: antesGroups } as never);
  useExpenseStore.setState({ expenses: antesExpenses } as never);
  useCommentStore.setState({ comments: antesComments } as never);
}

beforeEach(() => {
  jest.requireMock('../relay').__reset();
  mockAnnounce.mockClear();
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useNoticeInboxStore.setState({ items: [] } as never);

  // devB: ya tiene el grupo y el gasto sincronizados de antes (escenario real
  // del reporte del PO — no es un miembro nuevo, el gasto ya se veía).
  useAuthStore.setState({ currentUser: { id: DEV_B } as User } as never);
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [gasto()] } as never);
  useCommentStore.setState({ comments: [] } as never);
  useUserStore.setState({ users: [{ id: DEV_B, name: 'B' } as User] } as never);
  limpiarPendienteDeDrenaje('G');
  marcarPendienteDeDrenaje('G');
});

it('devB drena el comentario de devA y recibe el aviso (announce + bandeja)', async () => {
  await publicarComoA([{
    id: 'c1', expenseId: 'e1', authorId: DEV_A, text: 'Quedó bien',
    createdAt: 1, updatedAt: 1_000, isDeleted: false,
  } as ExpenseComment]);

  // devB (sesión activa) drena.
  useAuthStore.setState({ currentUser: { id: DEV_B } as User } as never);
  const aplicado = await drainNow('G');

  expect(aplicado).toBeGreaterThan(0);
  expect(useCommentStore.getState().comments.map(c => c.id)).toEqual(['c1']); // llegó y se ve

  expect(mockAnnounce).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ kind: 'comment', groupId: 'G', count: 1 })]),
  );

  const fila = useNoticeInboxStore.getState().items.find(i => i.notice.kind === 'comment');
  expect(fila).toBeTruthy();
  expect(fila!.readAt).toBeNull();
});

it('control: el propio comentario de devB no genera aviso al drenar su reflejo', async () => {
  // devB comenta el mismo gasto (localmente) y ese comentario vuelve a
  // aparecer en la MISMA publicación de A que devB drena (A republica el
  // estado completo del grupo, regla #8 — el sobre lleva estado).
  useCommentStore.setState({
    comments: [{
      id: 'cB', expenseId: 'e1', authorId: DEV_B, text: 'gracias',
      createdAt: 1, updatedAt: 1_000, isDeleted: false,
    } as ExpenseComment],
  } as never);

  await publicarComoA([{
    id: 'cB', expenseId: 'e1', authorId: DEV_B, text: 'gracias',
    createdAt: 1, updatedAt: 1_000, isDeleted: false,
  } as ExpenseComment]);

  useAuthStore.setState({ currentUser: { id: DEV_B } as User } as never);
  await drainNow('G');

  const avisosDeComentario = mockAnnounce.mock.calls
    .flatMap(([notices]) => notices as { kind: string }[])
    .filter(n => n.kind === 'comment');
  expect(avisosDeComentario).toEqual([]);
});
