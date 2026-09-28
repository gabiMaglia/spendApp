import { acotarDeltaAlGrupo, type LocalSnapshot } from '../acotarDeltaAlGrupo';
import { MAX_NOTA, MAX_MIEMBROS } from '@/src/sync/nucleo/topes';
import type { SyncDelta } from '../applyDelta';

/**
 * SEC-07 (T-150): recibir (`acotarDeltaAlGrupo`) usa un único predicado —
 * sólo bytes (`MAX_REGISTRO_BYTES`) y `memberIds.length > MAX_MIEMBROS`. Los
 * topes de caracteres (200/2.000) ya NO se aplican acá.
 *
 * T-193: la parte de "publicar" de esta comparación (`sliceEntities`) se
 * borró — el publicador real es `relay/cubos.ts` desde T-191, sin uso de
 * `sliceEntities` hace rato. El describe que comparaba las dos puertas se
 * fue con ella.
 */
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

const miembrosDeMas = Array.from({ length: MAX_MIEMBROS + 1 }, (_, i) => `u${i}`);

it('un gasto que pesa más que el tope duro se descarta; los demás pasan', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const splits = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
  const out = acotarDeltaAlGrupo(
    delta({ expenses: [gasto('bomba', { splits }), gasto('ok')] }),
    'g1', vacio, desc,
  );
  expect(out.expenses.map(e => e.id)).toEqual(['ok']);
  expect(desc).toEqual({ count: 1, motivos: ['expense:bytes'] });
});

it('un grupo con memberIds enorme se descarta', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const g = { id: 'g1', name: 'Viaje', memberIds: miembrosDeMas, updatedAt: 1, isDeleted: false } as never;
  const out = acotarDeltaAlGrupo(delta({ groups: [g] }), 'g1', vacio, desc);
  expect(out.groups).toEqual([]);
  expect(desc.motivos).toEqual(['group:memberIds']);
});

it('sin acumulador, descarta igual y no tira', () => {
  const splits = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
  const out = acotarDeltaAlGrupo(delta({ expenses: [gasto('bomba', { splits })] }), 'g1', vacio);
  expect(out.expenses).toEqual([]);
});

it('D1 (QA/verifier) — una description/note/name larga (dato legado, sin maxLength antes de T-150) YA NO se descarta al recibir', () => {
  const legado = gasto('legado', { description: 'x'.repeat(300), note: 'y'.repeat(MAX_NOTA + 500) });
  const desc = { count: 0, motivos: [] as string[] };
  const out = acotarDeltaAlGrupo(delta({ expenses: [legado] }), 'g1', vacio, desc);
  expect(out.expenses).toEqual([legado]);
  expect(desc.count).toBe(0);
});

// D2 (QA/verifier): un tombstone nunca se descarta al recibir por contenido.
it('D2 — un tombstone con memberIds heredado > MAX_MIEMBROS de antes del borrado NO se descarta', () => {
  const tombstoneGrupo = { id: 'g1', name: 'Viaje', memberIds: miembrosDeMas, updatedAt: 5, isDeleted: true } as never;
  const desc = { count: 0, motivos: [] as string[] };
  const out = acotarDeltaAlGrupo(delta({ groups: [tombstoneGrupo] }), 'g1', vacio, desc);
  expect(out.groups).toEqual([tombstoneGrupo]);
  expect(desc.count).toBe(0);
});

it('pagos, recurrentes, comentarios y perfiles también se miden por bytes', () => {
  const desc = { count: 0, motivos: [] as string[] };
  const splitsPesados = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
  const out = acotarDeltaAlGrupo(delta({
    expenses: [gasto('e1')],
    payments: [{ id: 'p1', groupId: 'g1', splits: splitsPesados, updatedAt: 1, isDeleted: false } as never],
    recurring: [{ id: 'r1', groupId: 'g1', splits: splitsPesados, updatedAt: 1, isDeleted: false } as never],
    comments: [{ id: 'c1', expenseId: 'e1', text: 'hola', splits: splitsPesados, updatedAt: 1, isDeleted: false } as never],
    users: [{ id: 'nuevo', name: 'x', splits: splitsPesados, updatedAt: 1, isDeleted: false } as never],
  }), 'g1', vacio, desc);
  expect(out.payments).toEqual([]);
  expect(out.recurring).toEqual([]);
  expect(out.comments).toEqual([]);
  expect(out.users).toEqual([]);
  expect(desc.count).toBe(4);
});
