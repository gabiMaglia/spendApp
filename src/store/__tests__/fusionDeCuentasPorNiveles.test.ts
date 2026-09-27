import { mergeAccountData, type StoreAFusionar } from '../mergeAccountData';
import type { SimpleStorage } from '@/src/utils/createStorage';
import type { Expense } from '@/src/types/models';

/**
 * TEC-03 (T-142a / T-149). `mergeAccountData.mergeById` era un TERCER LWW:
 * registro entero por `updatedAt`, sin desempate ni unión de los campos
 * colaborativos. Fusionar dos cuentas del mismo dueño podía perder una
 * disputa de autoría que sólo estaba en la cuenta absorbida, y su docblock
 * decía «la misma semántica que el sync» — falso desde T-041.
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
  updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Expense);

function leer<T>(st: SimpleStorage, base: string, uid: string): T[] {
  return JSON.parse(st.getString(`${base}::u:${uid}`)!) as T[];
}

it('una disputa de autoría que sólo estaba en la cuenta absorbida sobrevive a la fusión', () => {
  const st = fakeStorage();
  // `autoriaDisputada` (T-170) es el campo colaborativo que le queda a
  // `Expense`: un aporte de un tercero que la fusión no puede perder aunque
  // su lado no gane el `updatedAt`. No hace falta que la firma verifique
  // (el merge no la mira).
  const nucleoCompetidor = {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 1, currency: 'ARS' as const, paidById: 'beto',
    payers: [], splits: [], splitMode: 'equal' as const, category: 'food' as const, date: 0, createdAt: 0,
    createdById: 'beto', note: '', rev: 1, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
  };
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([gasto({ updatedAt: NOW - 1000 })])); // más nuevo, sin disputa
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([
    gasto({ autoriaDisputada: [nucleoCompetidor] }),
  ])); // más viejo, con disputa

  mergeAccountData([[st, 'data_v1', 'expense'] as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Expense>(st, 'data_v1', APPLE)[0]!.autoriaDisputada).toEqual([nucleoCompetidor]);
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
