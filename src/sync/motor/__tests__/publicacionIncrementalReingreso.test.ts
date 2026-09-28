/**
 * T-191, Task 2 (spec §7/§8 C5(b)) — P23: el ledger local de cubos publicados
 * tiene que olvidarse cuando el buzón, del otro lado, se vació — si no, la
 * próxima publicación cree que casi todo sigue "al día" y manda sólo el
 * manifiesto sobre un buzón vacío. Dos caminos lo disparan:
 *  - `deleteMyGroupEnvelopes` (T-088, purga del buzón propio).
 *  - `marcarPendienteDeDrenaje` (T-089, reingreso a un grupo).
 *
 * Va en archivo aparte de `publicacionIncremental.test.ts` porque necesita
 * los stores reales de HushSplit (`publishToGroup`, `pendingDrain`), no sólo
 * el núcleo — es la integración lo que se está probando acá.
 */
jest.mock('@/src/sync/adaptadores/supabase/relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, _c = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async () => ({ ok: true, envelopes: [], cursor: 0 }),
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
// T-206-A (D15): pendingDrain ahora importa olvidarCursor directo de
// './cursor' (motor/cursor.ts), sin pasar por relayEngine. Se mockea el
// módulo real (no virtual) preservando el resto con requireActual.
jest.mock('../cursor', () => ({
  ...jest.requireActual('../cursor'),
  olvidarCursor: jest.fn(),
}));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { publishToGroup, deleteMyGroupEnvelopes } from '../relaySync';
import { marcarPendienteDeDrenaje } from '../pendingDrain';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('@/src/sync/adaptadores/supabase/relay') as {
  __reset: () => void;
  __buzones: Map<string, { ckey?: string }[]>;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string): Expense => ({
  id, groupId: 'G', description: 'x', amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt: 1_000, isDeleted: false,
} as Expense);

function sobresDelTopic(): { ckey?: string }[] {
  const [topic] = [...relayMock.__buzones.keys()];
  return topic ? relayMock.__buzones.get(topic)! : [];
}

beforeEach(() => {
  relayMock.__reset();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
});

it('P23a: deleteMyGroupEnvelopes olvida el ledger — la próxima publicación es completa', async () => {
  await publishToGroup('G', 'u1', 'device1');
  const primeraCantidad = sobresDelTopic().length;
  expect(primeraCantidad).toBeGreaterThan(1);

  relayMock.__reset();
  await deleteMyGroupEnvelopes('G');

  const r = await publishToGroup('G', 'u1', 'device1');
  expect(r.ok).toBe(true);
  // Sin el olvido del ledger, esto mandaría sólo el manifiesto (1 sobre).
  expect(sobresDelTopic().length).toBe(primeraCantidad);
});

it('P23b: marcarPendienteDeDrenaje (reingreso) olvida el ledger — la próxima publicación es completa', async () => {
  await publishToGroup('G', 'u1', 'device1');
  const primeraCantidad = sobresDelTopic().length;
  expect(primeraCantidad).toBeGreaterThan(1);

  relayMock.__reset();
  const record = useGroupKeyStore.getState().getKey('G')!;
  const topic = await deriveTopic(groupKeyBytes('G')!, record.epoch);
  marcarPendienteDeDrenaje('G', topic);

  const r = await publishToGroup('G', 'u1', 'device1');
  expect(r.ok).toBe(true);
  expect(sobresDelTopic().length).toBe(primeraCantidad);
});
