/**
 * T-146 (TEC-02, huérfanas). La `ckey` de una rebanada se derivaba del PRIMER
 * id de la rebanada. Un gasto nuevo cuyo id ordena antes corría todos los
 * límites: cambiaba la `ckey` de TODAS las rebanadas siguientes, y las
 * anteriores quedaban en el buzón hasta el TTL de 30 días (la compactación es
 * por `ckey`). Con la `ckey` por índice, la misma cantidad de rebanadas
 * produce las mismas `ckey` publicación tras publicación.
 */
jest.mock('../relay', () => {
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
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup } from '../relaySync';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as { __reset: () => void; __buzones: Map<string, { ckey?: string }[]> };

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster) updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string): Expense => ({
  id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt: 1_000, isDeleted: false,
} as Expense);

function ckeysPublicadas(): Set<string> {
  const todos = [...relayMock.__buzones.values()].flat();
  return new Set(todos.map(e => e.ckey).filter((c): c is string => !!c));
}

beforeEach(() => {
  relayMock.__reset();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never); // `readScoped` necesita usuario activo
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
});

it('agregar un gasto que ordena PRIMERO no cambia las ckeys de las rebanadas existentes', async () => {
  const base = Array.from({ length: 200 }, (_, i) => gasto(`e${String(i + 100)}`)); // e100..e299
  useExpenseStore.setState({ expenses: base } as never);
  await publishToGroup('G', 'u1', 'device1');
  const antes = ckeysPublicadas();
  expect(antes.size).toBeGreaterThan(3);

  relayMock.__reset();
  useExpenseStore.setState({ expenses: [gasto('e000'), ...base] } as never); // ordena antes que todos
  await publishToGroup('G', 'u1', 'device1');
  const despues = ckeysPublicadas();

  const nuevas = [...despues].filter(c => !antes.has(c));
  // Como mucho UNA rebanada más (si el gasto extra desbordó la última). Con la
  // ckey por seedId eran casi todas.
  expect(nuevas.length).toBeLessThanOrEqual(1);
  expect(despues.size).toBeGreaterThanOrEqual(antes.size);
});

it('dos publicaciones idénticas producen exactamente las mismas ckeys', async () => {
  useExpenseStore.setState({ expenses: Array.from({ length: 50 }, (_, i) => gasto(`e${i}`)) } as never);
  await publishToGroup('G', 'u1', 'device1');
  const a = ckeysPublicadas();
  relayMock.__reset();
  await publishToGroup('G', 'u1', 'device1');
  expect(ckeysPublicadas()).toEqual(a);
});
