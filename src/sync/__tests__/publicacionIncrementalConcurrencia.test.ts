/**
 * V3 (verifier, T-191 segunda tanda) — `publishToGroup` no estaba serializado
 * por topic. Con dos llamadas concurrentes para el MISMO grupo (una ráfaga de
 * ediciones que dispara `schedulePublish` más un `publishNow` directo, o el
 * reintento de `reintentarPublicacionesConCuota` solapado con un cambio
 * nuevo) y respuestas de red en ORDEN INVERTIDO, el ledger puede terminar
 * registrando el digest de la publicación MÁS NUEVA mientras el buzón —del
 * otro lado— quedó compactado con el contenido de la MÁS VIEJA (la que
 * llegó al servidor después, por azar de la red). Consecuencia: una tercera
 * publicación (sin cambios locales) cree que todo sigue al día y nunca
 * vuelve a mandar el cubo — la edición se pierde silenciosamente para el
 * resto del grupo.
 *
 * Fix elegido: una cola de promesas por `topic` en `publishToGroup` — una
 * publicación en vuelo por grupo; la siguiente espera a que la anterior
 * termine (mismo patrón que usa Jazz/CoJSON para serializar escrituras por
 * CoValue). Este archivo prueba el INVARIANTE que la cola garantiza (nunca
 * dos `sendEnvelope` del mismo topic en vuelo a la vez) y la consecuencia
 * observable (el estado final publicado es consistente, sin gap).
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  let enCurso = 0;
  let maxEnCurso = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; enCurso = 0; maxEnCurso = 0; },
    __maxEnCurso: () => maxEnCurso,
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    // Compacta por (sender, ckey) AL LLEGAR, como el servidor real (T-032) —
    // y cede un tick de verdad (`setImmediate`) antes de "escribir", para que
    // dos llamadas concurrentes SIN la cola tengan chance real de
    // entrelazarse (si estuviera todo síncrono, nunca se vería la carrera).
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      enCurso++;
      maxEnCurso = Math.max(maxEnCurso, enCurso);
      await new Promise<void>(resolve => setImmediate(resolve));
      enCurso--;
      const lista = (buzones.get(topic) ?? []).filter(e => !(compactable && ckey && e.sender === sender && e.ckey === ckey));
      const mine = ++seq;
      lista.push({ seq: mine, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq: mine };
    },
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __maxEnCurso: () => number;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string, description = 'x', updatedAt = 1_000): Expense => ({
  id, groupId: 'G', description, amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt, isDeleted: false,
} as Expense);

beforeEach(() => {
  relayMock.__reset();
  clearManifestGaps();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
});

it('V3: dos publishToGroup concurrentes del mismo grupo nunca tienen sends en vuelo a la vez, y el estado final es consistente', async () => {
  useExpenseStore.setState({ expenses: [gasto('e1', 'v1', 1_000)] } as never);
  const p1 = publishToGroup('G', 'u1', 'device1');

  useExpenseStore.setState({ expenses: [gasto('e1', 'v2', 2_000)] } as never);
  const p2 = publishToGroup('G', 'u1', 'device1');

  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);

  // El invariante que la cola garantiza: nunca dos sends del mismo topic en
  // vuelo a la vez — sin la cola, esto da 2 (el punto exacto de la carrera).
  expect(relayMock.__maxEnCurso()).toBe(1);

  // Consecuencia observable: un tercero que entra ve el estado FINAL
  // consistente (v2), no una mezcla rota entre lo que el ledger cree
  // publicado y lo que el buzón realmente compactó.
  useExpenseStore.setState({ expenses: [] } as never);
  const r = await drainGroup('G', 'u2', 'deviceNuevo', 0);
  expect(r.ok).toBe(true);
  expect(manifestGapFor('G')).toBeNull();
  expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')?.description).toBe('v2');
});
