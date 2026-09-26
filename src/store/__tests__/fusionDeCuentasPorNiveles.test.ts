import { mergeAccountData, type StoreAFusionar } from '../mergeAccountData';
import type { SimpleStorage } from '@/src/utils/createStorage';
import type { Expense, Payment } from '@/src/types/models';

/**
 * TEC-03 (T-142a / T-149). `mergeAccountData.mergeById` era un TERCER LWW:
 * registro entero por `updatedAt`, sin desempate ni unión de los campos
 * colaborativos. Fusionar dos cuentas del mismo dueño podía perder un voto de
 * borrado o un acuse de saldado que sólo estaban en la cuenta absorbida, y
 * su docblock decía «la misma semántica que el sync» — falso desde T-041.
 */
const NOW = 1_790_000_000_000;
const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';

function fakeStorage(): SimpleStorage {
  const m = new Map<string, string>();
  return {
    getString: (k: string) => m.get(k),
    set: (k: string, v: unknown) => { m.set(k, String(v)); },
    getBoolean: () => undefined,
    delete: (k: string) => { m.delete(k); },
    clearAll: () => m.clear(),
  } as unknown as SimpleStorage;
}

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS', paidById: 'ana',
  splits: [], splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500, currency: 'ARS',
  date: 0, createdAt: 0, createdById: 'ana', updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Payment);

function leer<T>(st: SimpleStorage, base: string, uid: string): T[] {
  return JSON.parse(st.getString(`${base}::u:${uid}`)!) as T[];
}

it('un voto de borrado que sólo estaba en la cuenta absorbida sobrevive a la fusión', () => {
  const st = fakeStorage();
  const voto = { userId: 'beto', votedAt: NOW - 5000, action: 'delete' as const };
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([gasto({ updatedAt: NOW - 1000 })]));   // más nuevo, sin voto
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([gasto({ deletionVotes: [voto] })]));     // más viejo, con voto

  mergeAccountData([[st, 'data_v1', 'expense'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Expense>(st, 'data_v1', APPLE)[0]!.deletionVotes).toEqual([voto]);
});

it('un acuse de saldado que sólo estaba en la cuenta absorbida sobrevive', () => {
  const st = fakeStorage();
  const acuse = { userId: 'beto', confirmedAt: NOW - 5000, action: 'confirm' as const };
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([pago({ updatedAt: NOW - 1000 })]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([pago({ confirmations: [acuse] })]));

  mergeAccountData([[st, 'data_v1', 'payment'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Payment>(st, 'data_v1', APPLE)[0]!.confirmations).toEqual([acuse]);
});

it('el núcleo se decide por rev, no por updatedAt: un monto con rev mayor gana aunque sea "más viejo"', () => {
  const st = fakeStorage();
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([gasto({ amount: 1000, rev: 5, updatedAt: NOW - 1000 })]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([gasto({ amount: 2000, rev: 6, updatedAt: NOW - 9000 })]));

  mergeAccountData([[st, 'data_v1', 'expense'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Expense>(st, 'data_v1', APPLE)[0]!.amount).toBe(2000);
});

it('empate exacto de updatedAt: el resultado es determinista y no depende de cuál es el destino', () => {
  const a = gasto({ description: 'A', rev: 0, updatedAt: 10 });
  const b = gasto({ description: 'B', rev: 0, updatedAt: 10 });
  const st1 = fakeStorage(); st1.set(`data_v1::u:${APPLE}`, JSON.stringify([a])); st1.set(`data_v1::u:${GOOGLE}`, JSON.stringify([b]));
  const st2 = fakeStorage(); st2.set(`data_v1::u:${APPLE}`, JSON.stringify([b])); st2.set(`data_v1::u:${GOOGLE}`, JSON.stringify([a]));

  mergeAccountData([[st1, 'data_v1', 'expense'] as StoreAFusionar], GOOGLE, APPLE, NOW);
  mergeAccountData([[st2, 'data_v1', 'expense'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Expense>(st1, 'data_v1', APPLE)[0]!.description)
    .toBe(leer<Expense>(st2, 'data_v1', APPLE)[0]!.description);
});

it('los perfiles (users) se fusionan con el LWW con tope de reloj', () => {
  const st = fakeStorage();
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([{ id: 'carol', name: 'Carol', updatedAt: NOW - 1000 }]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([{ id: 'carol', name: 'Vandalizada', updatedAt: 9e15 }]));

  mergeAccountData([[st, 'data_v1', 'lww'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<{ name: string }>(st, 'data_v1', APPLE)[0]!.name).toBe('Carol');
});
