import { acotarDeltaAlGrupo, type LocalSnapshot } from '../acotarDeltaAlGrupo';
import { MAX_NOTA, MAX_MIEMBROS } from '../topes';
import type { SyncDelta } from '../useSyncQR';

/** SEC-07 (T-150): un registro que pasa los topes no entra al merge, y se cuenta. */
const vacio: LocalSnapshot = {
  groupMemberIds: () => ['ana', 'beto'],
  expenseGroupId: () => undefined,
  paymentGroupId: () => undefined,
  recurringGroupId: () => undefined,
  commentExpenseId: () => undefined,
  knownUser: () => false,
};

const delta = (parte: Partial<SyncDelta>): SyncDelta => ({
  version: 1, fromUserId: 'mallory', timestamp: 0,
  groups: [], expenses: [], payments: [], users: [], ...parte,
} as SyncDelta);

const gasto = (id: string, extra: object = {}) =>
  ({ id, groupId: 'g1', description: 'Cena', amount: 1, updatedAt: 1, isDeleted: false, ...extra }) as never;

it('un gasto con note de megabytes se descarta; los demás pasan', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const out = acotarDeltaAlGrupo(
    delta({ expenses: [gasto('bomba', { note: 'x'.repeat(MAX_NOTA + 1) }), gasto('ok')] }),
    'g1', vacio, desc,
  );
  expect(out.expenses.map(e => e.id)).toEqual(['ok']);
  expect(desc).toEqual({ count: 1, motivos: ['expense:note'] });
});

it('un grupo con memberIds enorme se descarta', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const g = { id: 'g1', name: 'Viaje', memberIds: Array.from({ length: MAX_MIEMBROS + 1 }, (_, i) => `u${i}`), updatedAt: 1, isDeleted: false } as never;
  const out = acotarDeltaAlGrupo(delta({ groups: [g] }), 'g1', vacio, desc);
  expect(out.groups).toEqual([]);
  expect(desc.motivos).toEqual(['group:memberIds']);
});

it('sin acumulador, descarta igual y no tira', () => {
  const out = acotarDeltaAlGrupo(delta({ expenses: [gasto('bomba', { note: 'x'.repeat(MAX_NOTA + 1) })] }), 'g1', vacio);
  expect(out.expenses).toEqual([]);
});

it('pagos, recurrentes, comentarios y perfiles también se miden', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const largo = 'x'.repeat(MAX_NOTA + 1);
  const out = acotarDeltaAlGrupo(delta({
    expenses: [gasto('e1')],
    payments: [{ id: 'p1', groupId: 'g1', note: largo, updatedAt: 1, isDeleted: false } as never],
    recurring: [{ id: 'r1', groupId: 'g1', note: largo, updatedAt: 1, isDeleted: false } as never],
    comments: [{ id: 'c1', expenseId: 'e1', text: 'hola', note: largo, updatedAt: 1, isDeleted: false } as never],
    users: [{ id: 'nuevo', name: 'x'.repeat(201), updatedAt: 1, isDeleted: false } as never],
  }), 'g1', vacio, desc);
  expect(out.payments).toEqual([]);
  expect(out.recurring).toEqual([]);
  expect(out.comments).toEqual([]);
  expect(out.users).toEqual([]);
  expect(desc.count).toBe(4);
});
