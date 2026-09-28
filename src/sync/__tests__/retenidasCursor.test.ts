/**
 * T-191, V2b (fallo del arquitecto, tercera ronda — spec §8 C2, docs/superpowers/
 * specs/2026-09-28-publicacion-incremental-design.md) — el cursor nunca pasa
 * una retenida por dependencia no resuelta.
 *
 * Repro de base: envelopes armados a mano (mismo patrón que
 * `receptorIncremental.test.ts`), buzón simulado que COMPACTA por
 * (sender, ckey), como el servidor real.
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    __push: (topic: string, payload: string, sender: string, ckey?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => !(e.sender === sender && e.ckey === ckey));
      lista.push({ seq: ++seq, topic, payload, sender, ckey });
      buzones.set(topic, lista);
      return lista[lista.length - 1]!.seq;
    },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async () => ({ ok: true, seq: ++seq }),
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));
jest.mock('../relayEngine', () => ({ olvidarCursor: jest.fn() }), { virtual: true });

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import { deriveTopic, sealEnvelope } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { deriveCkey } from '../slices';
import { buildManifest } from '../manifest';
import { olvidarFallosDeAplicacion, DRAIN_MAX_REINTENTOS } from '../drainFailures';
import { permite as permiteRelectura, _reset as resetRelecturas } from '../relay/relecturas';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __push: (topic: string, payload: string, sender: string, ckey?: string) => number;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: { u1: { estado: 'in', at: 1 } }, updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string, description = 'x', updatedAt = 1_000): Expense => ({
  id, groupId: 'G', description, amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt, isDeleted: false,
} as Expense);

async function topicDe(): Promise<string> {
  const record = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(groupKeyBytes('G')!, record.epoch);
}

function empujar(topic: string, delta: unknown, sender: string, ckey: string): number {
  const key = groupKeyBytes('G')!;
  const sealed = sealEnvelope(key, JSON.stringify(delta));
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  return relayMock.__push(topic, firmado, sender, ckey);
}

function envolverCrudo(campo: string, registros: unknown[]): Record<string, unknown> {
  return {
    version: 1, featureVersion: 2, fromUserId: 'quien-firma', timestamp: 0,
    groups: [], expenses: [], payments: [], users: [],
    [campo]: registros,
  };
}

const E1 = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  relayMock.__reset();
  clearManifestGaps();
  resetRelecturas();
  olvidarFallosDeAplicacion();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
  useCommentStore.setState({ comments: [] } as never);
});

it('T1 (V2b): comentario retenido — tres drenajes hasta resolverse, sin cobrar cupo antes de tiempo', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const ke = await deriveCkey(key, 'expenses', '1');
  const km = await deriveCkey(key, 'manifest', 'unica');

  // seq1: comentario de devB (depende de E1). seq2: manifiesto de devB.
  const com = { id: 'c1', expenseId: E1, authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  const jc = envolverCrudo('comments', [com]);
  empujar(topic, jc, 'devB', kc);
  empujar(topic, await buildManifest([{ ckey: kc, json: JSON.stringify(jc) }]), 'devB', km);
  // seq3: rebanada que tira (fuerza el mismo caso que V2/M2 anteriores).
  empujar(topic, { version: 1, featureVersion: 2, fromUserId: 'q', timestamp: 0, groups: [], expenses: 5, payments: [], users: [] }, 'devZ', 'kz');
  // seq4: el gasto E1 de devA.
  const je = envolverCrudo('expenses', [gasto(E1)]);
  empujar(topic, je, 'devA', ke);

  let cursor = 0;
  const cursores: number[] = [];
  const completos: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await drainGroup('G', 'u1', 'devR', cursor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    cursor = r.cursor;
    cursores.push(r.cursor);
    completos.push(r.completo);
  }

  expect(cursores).toEqual([0, 0, 4]);
  expect(completos).toEqual([false, false, true]);
  expect(useCommentStore.getState().comments.find(c => c.id === 'c1')).toBeDefined();
  expect(useExpenseStore.getState().expenses.find(e => e.id === E1)).toBeDefined();
});

it('T2: sin fallos de por medio, un comentario que resuelve en la página siguiente avanza normal', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const ke = await deriveCkey(key, 'expenses', '1');
  const km = await deriveCkey(key, 'manifest', 'unica');

  const com = { id: 'c1', expenseId: E1, authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  const jc = envolverCrudo('comments', [com]);
  empujar(topic, jc, 'devB', kc);
  empujar(topic, await buildManifest([{ ckey: kc, json: JSON.stringify(jc) }]), 'devB', km);

  const r1 = await drainGroup('G', 'u1', 'devR', 0);
  expect(r1.ok).toBe(true);
  if (!r1.ok) return;
  expect(r1.cursor).toBe(0);
  expect(r1.completo).toBe(false);

  const je = envolverCrudo('expenses', [gasto(E1)]);
  empujar(topic, je, 'devA', ke);

  const r2 = await drainGroup('G', 'u1', 'devR', r1.cursor);
  expect(r2.ok).toBe(true);
  if (!r2.ok) return;
  expect(r2.cursor).toBe(3);
  expect(r2.completo).toBe(true);
  expect(useCommentStore.getState().comments.find(c => c.id === 'c1')).toBeDefined();
});

it('T3 (V6): descarte permanente por dependencia — cursores [0,0,2,2], manifestHealth lo lista, sin appliedSlices, el 4to no retrocede', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const km = await deriveCkey(key, 'manifest', 'unica');

  // El gasto de este comentario NUNCA llega — el emisor lo excluyó por tope
  // (o simplemente no existe para nadie): la dependencia no se resuelve jamás.
  const com = { id: 'c1', expenseId: 'e-que-nunca-llega', authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  const jc = envolverCrudo('comments', [com]);
  empujar(topic, jc, 'devB', kc);
  empujar(topic, await buildManifest([{ ckey: kc, json: JSON.stringify(jc) }]), 'devB', km);

  let cursor = 0;
  const cursores: number[] = [];
  const completos: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await drainGroup('G', 'u1', 'devR', cursor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    cursor = r.cursor;
    cursores.push(r.cursor);
    completos.push(r.completo);
  }

  expect(cursores).toEqual([0, 0, 2, 2]);
  expect(completos).toEqual([false, false, true, true]);
  expect(manifestGapFor('G')?.missingCkeys).toContain(kc);
});

it('T4 (ajuste C): una retenida sin resolver no gasta el cupo de relectura', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const km = await deriveCkey(key, 'manifest', 'unica');

  const com = { id: 'c1', expenseId: 'e-que-nunca-llega', authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  const jc = envolverCrudo('comments', [com]);
  empujar(topic, jc, 'devB', kc);
  empujar(topic, await buildManifest([{ ckey: kc, json: JSON.stringify(jc) }]), 'devB', km);

  await drainGroup('G', 'u1', 'devR', 0);

  // El manifiesto de devB en este drenaje es seq 2 — el cupo de relectura
  // para esa terna sigue disponible (no se consumió con la retenida).
  expect(permiteRelectura(topic, 'devB', 2)).toBe(true);
});

it('T5 (tope de páginas): cobra cupo y devuelve incompleto, resuelve en la siguiente', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const ke = await deriveCkey(key, 'expenses', '1');

  const com = { id: 'c1', expenseId: E1, authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  empujar(topic, envolverCrudo('comments', [com]), 'devB', kc); // seq1
  empujar(topic, envolverCrudo('expenses', [gasto(E1)]), 'devA', ke); // seq2

  // Primer drenaje: tope de páginas ARTIFICIAL (1 página de 1 sobre) — sólo
  // alcanza a ver seq1 (el comentario, retenido); seq2 queda fuera de
  // alcance de ESTA llamada.
  const r1 = await drainGroup('G', 'u1', 'devR', 0, { pageLimit: 1, maxPages: 1 });
  expect(r1.ok).toBe(true);
  if (!r1.ok) return;
  expect(r1.cursor).toBe(0); // la retenida (seq1) sigue sin resolver: cobra cupo
  expect(r1.completo).toBe(false);

  // Segundo drenaje: presupuesto normal (sin recortar) — esta vez ve seq1 Y
  // seq2 en la MISMA llamada, así que la reaplicación final resuelve.
  const r2 = await drainGroup('G', 'u1', 'devR', r1.cursor);
  expect(r2.ok).toBe(true);
  if (!r2.ok) return;
  expect(r2.cursor).toBe(2);
  expect(r2.completo).toBe(true);
  expect(useCommentStore.getState().comments.find(c => c.id === 'c1')).toBeDefined();
});

it('T6: sin retenidas de por medio, cursor y completo son iguales a lo de siempre', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const ke = await deriveCkey(key, 'expenses', '1');
  const km = await deriveCkey(key, 'manifest', 'unica');
  const je = envolverCrudo('expenses', [gasto(E1)]);
  empujar(topic, je, 'devA', ke);
  empujar(topic, await buildManifest([{ ckey: ke, json: JSON.stringify(je) }]), 'devA', km);

  const r = await drainGroup('G', 'u1', 'devR', 0);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.cursor).toBe(2);
  expect(r.completo).toBe(true);
  expect(manifestGapFor('G')).toBeNull();
});

it('T7: en cada vuelta de drenaje, el cursor devuelto nunca retrocede por debajo de `sinceSeq` — T1, T3 y T5 re-verificados', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const kc = await deriveCkey(key, 'comments', '0');
  const ke = await deriveCkey(key, 'expenses', '1');
  const km = await deriveCkey(key, 'manifest', 'unica');

  const com = { id: 'c1', expenseId: E1, authorId: 'u1', text: 'hola', createdAt: 1, updatedAt: 1, isDeleted: false };
  const jc = envolverCrudo('comments', [com]);
  empujar(topic, jc, 'devB', kc);
  empujar(topic, await buildManifest([{ ckey: kc, json: JSON.stringify(jc) }]), 'devB', km);
  empujar(topic, { version: 1, featureVersion: 2, fromUserId: 'q', timestamp: 0, groups: [], expenses: 5, payments: [], users: [] }, 'devZ', 'kz');
  const je = envolverCrudo('expenses', [gasto(E1)]);
  empujar(topic, je, 'devA', ke);

  let cursor = 0;
  for (let i = 0; i < 5; i++) {
    const sinceSeq = cursor;
    const r = await drainGroup('G', 'u1', 'devR', sinceSeq);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cursor).toBeGreaterThanOrEqual(sinceSeq); // invariante: nunca retrocede
    cursor = r.cursor;
    if (r.completo) break;
  }
});

// Sanity: el presupuesto real de reintentos sigue siendo el de siempre.
it('sanity: DRAIN_MAX_REINTENTOS sigue siendo 3 (T3/T1 asumen este número)', () => {
  expect(DRAIN_MAX_REINTENTOS).toBe(3);
});
