import { mergeAccountData, type StoreAFusionar, type ReglaDeFusion } from '../mergeAccountData';
import { MERGEABLE_STORES, mergeAccounts } from '../accountLink';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { usePersonalStore } from '../personalStore';
import { useExpenseStore } from '../expenseStore';
import { mergeExpensesPure } from '../mergeExpensesPure';
import { useGroupStore } from '../groupStore';
import { mergeGroupsPure } from '../mergeGroupsPure';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import { mergeUsersPure } from '../mergeUsersPure';
import { useRecurringStore } from '../recurringStore';
import { useCommentStore } from '../commentStore';
import type { Syncable } from '../lww';
import type { SimpleStorage } from '@/src/utils/createStorage';
import type {
  Expense, Group, User, PersonalEntry, Payment, RecurringExpense, ExpenseComment,
} from '@/src/types/models';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/**
 * T-149 · Verificador ciego, ronda 1 (D1, D2, D3, D4).
 *
 * `mergeAccountData` llamaba al merge DESNUDO (`mergeByIdLevels`/`mergeUsersLWW`)
 * en vez de a la función que cada store usa de verdad al sincronizar, que hace
 * más cosas antes y después de ese merge (recibo, modo de borrado, avatar).
 * Fusionar dos cuentas y sincronizar esos mismos dos estados daban resultados
 * distintos — el invariante que la fusión promete no se cumplía.
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

function leer<T>(st: SimpleStorage, base: string, uid: string): T[] {
  return JSON.parse(st.getString(`${base}::u:${uid}`)!) as T[];
}

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS', paidById: 'ana',
  splits: [], splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Expense);

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS', deletionMode: 'consensus',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Group);

const entrada = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'pe1', kind: 'expense', description: 'Nafta', amount: 500, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: NOW - 10_000, isDeleted: false, ...over,
} as PersonalEntry);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500, currency: 'ARS',
  date: 0, createdAt: 0, createdById: 'ana', updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as Payment);

const recurrente = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: 'r1', groupId: 'g1', description: 'Netflix', amount: 100, currency: 'ARS', paidById: 'ana',
  splitMode: 'equal', memberIds: ['ana', 'beto'], category: 'other',
  rule: { frequency: 'monthly', startDate: 0 } as RecurringExpense['rule'],
  lastMaterializedAt: null, isActive: true,
  createdAt: 0, createdById: 'ana', updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as RecurringExpense);

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: 'ana', text: 'Che', createdAt: 0,
  updatedAt: NOW - 10_000, isDeleted: false, rev: 5, ...over,
} as ExpenseComment);

// D1 -------------------------------------------------------------------
it('D1: el recibo local sobrevive a la fusión de expenses, igual que al sync', () => {
  const st = fakeStorage();
  // destino: tiene recibo. origen (absorbida): mismo gasto sin recibo, más nuevo.
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([gasto({ receiptImageUri: 'file://r.jpg' })]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([gasto({ updatedAt: NOW - 1000 })]));

  mergeAccountData([[st, 'data_v1', mergeExpensesPure] as unknown as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Expense>(st, 'data_v1', APPLE)[0]!.receiptImageUri).toBe('file://r.jpg');
});

// D2 -------------------------------------------------------------------
it('D2: deletionMode del destino sobrevive a la fusión de groups (T-053) — no baja de consensus a open', () => {
  const st = fakeStorage();
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([grupo({ deletionMode: 'consensus' })]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([grupo({ deletionMode: 'open', updatedAt: NOW - 1000 })]));

  mergeAccountData([[st, 'data_v1', mergeGroupsPure] as unknown as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<Group>(st, 'data_v1', APPLE)[0]!.deletionMode).toBe('consensus');
});

// D3 -------------------------------------------------------------------
// Corre por `mergeAccounts` de verdad (no una regla armada a mano en el
// test): así si `accountLink.ts` vuelve a poner el tope de reloj para
// `personal`, este test lo agarra igual que agarraría el mutante del
// verificador (D5).
it('D3: personal se fusiona con mergeByIdLWW (sin tope) — un movimiento adelantado no se pierde', () => {
  createSecureStorage('personal').clearAll();
  createSecureStorage('personal').set(`entries_v1::u:${APPLE}`, JSON.stringify([]));
  createSecureStorage('personal').set(
    `entries_v1::u:${GOOGLE}`,
    JSON.stringify([entrada({ updatedAt: NOW + 10 * 24 * 60 * 60 * 1000 })]),
  );

  mergeAccounts(GOOGLE, APPLE);

  const raw = createSecureStorage('personal').getString(`entries_v1::u:${APPLE}`);
  expect(JSON.parse(raw!)).toHaveLength(1);
});

// Avatar (mismo tipo de defecto que D1, encontrado al auditar los 7 stores) --
it('el avatar local sobrevive a la fusión de users, igual que al sync', () => {
  const st = fakeStorage();
  const conAvatar: User = { id: 'carol', name: 'Carol', updatedAt: NOW - 10_000, avatar: 'b64==', isDeleted: false } as User;
  const sinAvatar: User = { id: 'carol', name: 'Carol', updatedAt: NOW - 1000, isDeleted: false } as User;
  st.set(`data_v1::u:${APPLE}`, JSON.stringify([conAvatar]));
  st.set(`data_v1::u:${GOOGLE}`, JSON.stringify([sinAvatar]));

  mergeAccountData([[st, 'data_v1', mergeUsersPure] as unknown as StoreAFusionar], GOOGLE, APPLE, NOW);

  expect(leer<User>(st, 'data_v1', APPLE)[0]!.avatar).toBe('b64==');
});

// D4 -------------------------------------------------------------------
it('D4: el docblock de mergeAccounts ya no dice "LWW por updatedAt" (regla por store)', () => {
  const src = readFileSync(join(__dirname, '..', 'accountLink.ts'), 'utf8');
  const bloque = src.slice(src.indexOf('export function mergeAccounts') - 400, src.indexOf('export function mergeAccounts'));
  expect(bloque).not.toMatch(/Uni[oó]n con LWW por `updatedAt`/);
});

// Invariante general (pedido del orquestador): para cada store que
// `accountLink` declara en `MERGEABLE_STORES`, fusionar dos scopes tiene que
// dar EXACTAMENTE lo mismo que sincronizar esos dos mismos estados a través
// de la acción real del store — no una aproximación, el mismo array.
type CasoDeStore = {
  bucket: string;
  seedCurrent: (over?: Record<string, unknown>) => Syncable;
  seedIncoming: (over?: Record<string, unknown>) => Syncable;
  /** Corre el merge del store DE VERDAD (zustand) y devuelve el resultado. */
  viaStore: (current: Syncable[], incoming: Syncable[], now: number) => Syncable[];
};

const CASOS: CasoDeStore[] = [
  {
    bucket: 'groups',
    seedCurrent: (o) => grupo({ deletionMode: 'consensus', ...o }) as unknown as Syncable,
    seedIncoming: (o) => grupo({ deletionMode: 'open', updatedAt: NOW - 1000, ...o }) as unknown as Syncable,
    viaStore: (current, incoming, now) => {
      useGroupStore.setState({ groups: current as unknown as Group[] });
      useGroupStore.getState().mergeGroups(incoming as unknown as Group[], now);
      return useGroupStore.getState().groups as unknown as Syncable[];
    },
  },
  {
    bucket: 'expenses',
    seedCurrent: (o) => gasto({ receiptImageUri: 'file://r.jpg', ...o }) as unknown as Syncable,
    seedIncoming: (o) => gasto({ updatedAt: NOW - 1000, ...o }) as unknown as Syncable,
    viaStore: (current, incoming, now) => {
      useExpenseStore.setState({ expenses: current as unknown as Expense[] });
      useExpenseStore.getState().mergeExpenses(incoming as unknown as Expense[], now);
      return useExpenseStore.getState().expenses as unknown as Syncable[];
    },
  },
  {
    // rev/confirmations discriminan mergeByIdLevels (núcleo por rev + acuses
    // unidos) de un LWW bare (T-149 · mutante payments): el destino tiene rev
    // MAYOR y un acuse propio, la absorbida rev menor pero updatedAt más
    // nuevo. Por niveles el núcleo (amount) del destino sobrevive y el acuse
    // no se pierde; con LWW puro ganaría la absorbida entera —justo el
    // defecto de TEC-03 que esta fila tiene que cazar.
    bucket: 'payments',
    seedCurrent: (o) => pago({
      rev: 7, confirmations: [{ userId: 'beto', confirmedAt: NOW - 20_000, action: 'confirm' }], ...o,
    }) as unknown as Syncable,
    seedIncoming: (o) => pago({ updatedAt: NOW - 1000, rev: 3, amount: 900, ...o }) as unknown as Syncable,
    viaStore: (current, incoming, now) => {
      usePaymentStore.setState({ payments: current as unknown as Payment[] });
      usePaymentStore.getState().mergePayments(incoming as unknown as Payment[], now);
      return usePaymentStore.getState().payments as unknown as Syncable[];
    },
  },
  {
    bucket: 'users',
    seedCurrent: (o) => ({ id: 'carol', name: 'Carol', updatedAt: NOW - 10_000, avatar: 'b64==', isDeleted: false, ...o } as unknown as Syncable),
    seedIncoming: (o) => ({ id: 'carol', name: 'Carol', updatedAt: NOW - 1000, isDeleted: false, ...o } as unknown as Syncable),
    viaStore: (current, incoming, now) => {
      useUserStore.setState({ users: current as unknown as User[] });
      useUserStore.getState().mergeUsers(incoming as unknown as User[], now);
      return useUserStore.getState().users as unknown as Syncable[];
    },
  },
  {
    // rev discrimina el núcleo (T-149 · mutante recurring): destino con rev
    // MAYOR y `amount` propio, absorbida con rev menor pero updatedAt más
    // nuevo. Por niveles gana el `amount` del destino; con LWW puro ganaría
    // la absorbida entera.
    bucket: 'recurring',
    seedCurrent: (o) => recurrente({ rev: 7, ...o }) as unknown as Syncable,
    seedIncoming: (o) => recurrente({ updatedAt: NOW - 1000, rev: 3, amount: 200, ...o }) as unknown as Syncable,
    viaStore: (current, incoming, now) => {
      useRecurringStore.setState({ recurring: current as unknown as RecurringExpense[] });
      useRecurringStore.getState().mergeRecurring(incoming as unknown as RecurringExpense[], now);
      return useRecurringStore.getState().recurring as unknown as Syncable[];
    },
  },
  {
    // rev discrimina el núcleo (T-149 · mutante comments): destino con rev
    // MAYOR y `text` propio, absorbida con rev menor pero updatedAt más
    // nuevo. Por niveles gana el `text` del destino; con LWW puro ganaría la
    // absorbida entera.
    bucket: 'comments',
    seedCurrent: (o) => comentario({ rev: 7, ...o }) as unknown as Syncable,
    seedIncoming: (o) => comentario({ updatedAt: NOW - 1000, rev: 3, text: 'Otro', ...o }) as unknown as Syncable,
    viaStore: (current, incoming, now) => {
      useCommentStore.setState({ comments: current as unknown as ExpenseComment[] });
      useCommentStore.getState().mergeComments(incoming as unknown as ExpenseComment[], now);
      return useCommentStore.getState().comments as unknown as Syncable[];
    },
  },
];

describe('invariante: fusionar da lo mismo que sincronizar, para cada store de MERGEABLE_STORES', () => {
  const porBucket = new Map<string, ReglaDeFusion>(
    MERGEABLE_STORES.map(([bucket, regla]) => [bucket as string, regla as ReglaDeFusion]),
  );

  it.each(CASOS)('$bucket: mergeAccountData($bucket) === el store fusionando los mismos dos estados', (caso) => {
    const regla = porBucket.get(caso.bucket);
    expect(regla).toBeDefined();

    const current = [caso.seedCurrent()];
    const incoming = [caso.seedIncoming()];

    // Vía sync: el store de verdad, con los mismos dos estados.
    const viaSync = caso.viaStore(
      current.map(r => ({ ...r })), incoming.map(r => ({ ...r })), NOW,
    );

    // Vía fusión: mergeAccountData con la regla que accountLink declaró para este bucket.
    const st = fakeStorage();
    const base = caso.bucket === 'personal' ? 'entries_v1' : 'data_v1';
    st.set(`${base}::u:${APPLE}`, JSON.stringify(current));
    st.set(`${base}::u:${GOOGLE}`, JSON.stringify(incoming));
    mergeAccountData([[st, base, regla!] as StoreAFusionar], GOOGLE, APPLE, NOW);
    const viaFusion = leer<Syncable>(st, base, APPLE);

    expect(viaFusion).toEqual(viaSync);
  });

  // `personal` no está en MERGEABLE_STORES (persiste bajo otra clave, se
  // fusiona aparte en `mergePersonal`), así que no hay lista de la que sacar
  // su regla. Por eso este caso corre por `mergeAccounts` DE VERDAD —el
  // mismo camino que produción, que toca `accountLink.ts:678`— y se compara
  // contra la acción real del store (`usePersonalStore.mergeEntries`), no
  // contra `mergePersonalPure` invocada dos veces a mano (D5 verifier: eso
  // se comparaba contra sí mismo y no agarraba el mutante que vuelve la
  // regla a `'lww'`).
  it('personal: mergeAccounts(...) === el store fusionando los mismos dos estados', () => {
    createSecureStorage('personal').clearAll();
    const current = [entrada()];
    const incoming = [entrada({ updatedAt: NOW - 1000, amount: 999 })];

    createSecureStorage('personal').set(`entries_v1::u:${APPLE}`, JSON.stringify(current));
    createSecureStorage('personal').set(`entries_v1::u:${GOOGLE}`, JSON.stringify(incoming));

    mergeAccounts(GOOGLE, APPLE);

    const raw = createSecureStorage('personal').getString(`entries_v1::u:${APPLE}`);
    const viaFusion = JSON.parse(raw!) as PersonalEntry[];

    usePersonalStore.setState({ entries: current.map(r => ({ ...r })) });
    usePersonalStore.getState().mergeEntries(incoming.map(r => ({ ...r })));
    const viaSync = usePersonalStore.getState().entries;

    expect(viaFusion).toEqual(viaSync);
  });
});
