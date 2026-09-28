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
import { publishToGroup, deleteMyGroupEnvelopes } from '../relaySync';
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

/**
 * T-191 (Task 2): con cubos por prefijo de id (`relay/cubos.ts`) la ckey de
 * un registro ya no depende del ORDEN de inserción ni de qué otros registros
 * lo acompañan — depende sólo de su propio id (mismo id ⇒ mismo cubo ⇒ misma
 * ckey, siempre). El caso que este test cubría (T-146: un id que ordena
 * antes corría los límites de la rebanada de índice k y re-claveaba TODAS
 * las siguientes) ya no puede pasar por construcción: no hay "límites" que
 * correr. Lo que se verifica ahora es esa garantía más fuerte — agregar un
 * gasto nuevo, ordene donde ordene, nunca cambia el CONTENIDO de un cubo que
 * no lo contiene, y por lo tanto nunca dispara el reenvío de una ckey que no
 * sea (a lo sumo) el propio cubo tocado + el manifiesto.
 */
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

  // Publicación incremental (T-191): sólo se reenvía lo que cambió. Todo lo
  // que salió en esta segunda vuelta tiene que ser una ckey YA CONOCIDA de la
  // primera (el cubo de `expenses` que recibió al gasto nuevo, más el
  // manifiesto, cuya ckey es la misma siempre) — nunca una ckey nueva, que
  // sería la señal de que el alta corrió los límites de OTRO cubo.
  for (const c of despues) expect(antes.has(c)).toBe(true);
  // Como mucho el cubo tocado + el manifiesto salen de nuevo; nunca "casi
  // todas" como con la ckey por índice de antes de T-146/T-191.
  expect(despues.size).toBeLessThanOrEqual(2);
});

/**
 * T-191: dos publicaciones IDÉNTICAS ya no mandan las mismas ckeys — la
 * segunda no manda casi nada, porque nada cambió (spec §2.2, P6). Lo que
 * sigue siendo cierto — y es lo que este test verifica — es que la ckey de
 * cada cubo es una función DETERMINISTA de la clave del grupo, el campo y el
 * prefijo: si se fuerza una republicación completa (`deleteMyGroupEnvelopes`
 * olvida el ledger local, T-191 spec §7/§8 C5(b)) sobre el MISMO contenido,
 * las ckeys que salen son EXACTAMENTE las mismas que la primera vez.
 */
it('el mismo contenido siempre deriva las mismas ckeys, incluso tras una republicación completa', async () => {
  useExpenseStore.setState({ expenses: Array.from({ length: 50 }, (_, i) => gasto(`e${i}`)) } as never);
  await publishToGroup('G', 'u1', 'device1');
  const a = ckeysPublicadas();
  expect(a.size).toBeGreaterThan(1);

  // Publicación idéntica: sin ledger que olvidar, sólo sale el manifiesto —
  // y esa ckey ya es parte de `a` (siempre la misma, por grupo/época).
  relayMock.__reset();
  await publishToGroup('G', 'u1', 'device1');
  expect([...ckeysPublicadas()].every(c => a.has(c))).toBe(true);

  // Se fuerza una republicación completa (simula T-088: purgar el buzón
  // propio olvida el ledger local, spec C5(b)) — mismo contenido, mismas
  // ckeys, sin faltar ni sobrar ninguna.
  relayMock.__reset();
  await deleteMyGroupEnvelopes('G');
  await publishToGroup('G', 'u1', 'device1');
  expect(ckeysPublicadas()).toEqual(a);
});
