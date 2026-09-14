import { acotarDeltaAlGrupo } from '../acotarDeltaAlGrupo';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import type { SyncDelta } from '../useSyncQR';

const meta = { updatedAt: 1_000, isDeleted: false };

function deltaBase(): SyncDelta {
  return {
    version: 1,
    featureVersion: 2,
    fromUserId: 'mallory',
    timestamp: 0,
    groups: [
      { id: 'A', name: 'A', memberIds: ['victim', 'mallory'], currency: 'ARS',
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
    ],
    expenses: [
      { id: 'eA', groupId: 'A', description: 'del grupo', amount: 10, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
      // Registro cruzado / de otro grupo — no debe sobrevivir al recorte.
      { id: 'eB', groupId: 'B', description: 'de otro grupo', amount: 20, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
      // El vector T-116: groupId '' se cuela a la pestaña Personal si no se filtra.
      { id: 'ePersonal', groupId: '', description: 'inyectado', amount: 30, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'mallory', deletionVotes: [], ...meta } as any,
    ],
    payments: [
      { id: 'pA', groupId: 'A', fromUserId: 'mallory', toUserId: 'victim', amount: 5,
        currency: 'ARS', date: 0, createdAt: 0, createdById: 'mallory', ...meta } as any,
      { id: 'pB', groupId: 'B', fromUserId: 'mallory', toUserId: 'victim', amount: 5,
        currency: 'ARS', date: 0, createdAt: 0, createdById: 'mallory', ...meta } as any,
    ],
    users: [
      { id: 'victim', name: 'Victim' } as any,
      { id: 'mallory', name: 'Mallory' } as any,
      // No es miembro de A ni local ni en el delta: no debería colarse.
      { id: 'ajeno', name: 'Ajeno' } as any,
    ],
    recurring: [
      { id: 'rA', groupId: 'A', description: 'de A', amount: 1, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', memberIds: ['victim'], category: 'food',
        rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null,
        isActive: true, createdAt: 0, createdById: 'victim', ...meta } as any,
      { id: 'rB', groupId: 'B', description: 'de B', amount: 1, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', memberIds: ['victim'], category: 'food',
        rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null,
        isActive: true, createdAt: 0, createdById: 'victim', ...meta } as any,
    ],
    comments: [
      { id: 'cA', expenseId: 'eA', authorId: 'mallory', text: 'de A', createdAt: 0, ...meta } as any,
      { id: 'cB', expenseId: 'eB', authorId: 'mallory', text: 'de B', createdAt: 0, ...meta } as any,
    ],
    personal: [
      { id: 'p1', type: 'expense', amount: 999, currency: 'ARS', description: 'inyectado',
        date: 0, updatedAt: 0, createdAt: 0, isDeleted: false } as any,
    ],
    groupKeys: [
      { groupId: 'B', key: 'ab'.repeat(32), epoch: 1e9 },
    ],
  };
}

/** Resetea las seis colecciones que alimentan el snapshot local por defecto. */
function limpiarStoresLocales() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useRecurringStore.setState({ recurring: [] });
  useCommentStore.setState({ comments: [] });
  useUserStore.setState({ users: [] });
}

describe('acotarDeltaAlGrupo — el receptor sólo aplica lo del grupo del topic', () => {
  beforeEach(limpiarStoresLocales);

  it('NUNCA adopta groupKeys, venga lo que venga', () => {
    expect(acotarDeltaAlGrupo(deltaBase(), 'A').groupKeys).toEqual([]);
  });

  it('NUNCA lleva movimientos personales', () => {
    expect(acotarDeltaAlGrupo(deltaBase(), 'A').personal).toEqual([]);
  });

  it('sólo conserva el grupo propio, no otros ids', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.groups.map(g => g.id)).toEqual(['A']);
  });

  it('descarta gastos de otro groupId y los de groupId vacío (T-116)', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.expenses.map(e => e.id)).toEqual(['eA']);
  });

  it('descarta pagos y recurrentes de otro grupo', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.payments.map(p => p.id)).toEqual(['pA']);
    expect(r.recurring!.map(x => x.id)).toEqual(['rA']);
  });

  it('los comentarios sólo sobreviven si cuelgan de un gasto que sobrevivió', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.comments!.map(c => c.id)).toEqual(['cA']);
  });

  // Ningún usuario del delta es local todavía (stores vacíos): pasan todos,
  // porque no hay perfil previo que pisar (caso (b) del criterio 1).
  it('con el store vacío (miembro nuevo), todos los perfiles del delta pasan', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.users.map(u => u.id).sort()).toEqual(['ajeno', 'mallory', 'victim']);
  });

  it('un usuario NUEVO (no conocido localmente) siempre entra, sin importar la membresía', () => {
    const delta = deltaBase();
    delta.users.push({ id: 'nuevo', name: 'Nuevo' } as any);

    const r = acotarDeltaAlGrupo(delta, 'A');
    expect(r.users.map(u => u.id)).toContain('nuevo');
  });

  it('un usuario YA CONOCIDO localmente y miembro LOCAL de A pasa', () => {
    useGroupStore.setState({ groups: [
      { id: 'A', name: 'A', memberIds: ['victim', 'mallory', 'local-only'], currency: 'ARS',
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
    ]});
    useUserStore.setState({ users: [{ id: 'local-only', name: 'Local' } as any] });
    const delta = deltaBase();
    delta.users.push({ id: 'local-only', name: 'Local actualizado' } as any);

    const r = acotarDeltaAlGrupo(delta, 'A');
    expect(r.users.map(u => u.id)).toContain('local-only');
  });

  it('grupo desconocido (sin registro local ni en el delta): no filtra por miembros inventados', () => {
    // No hay grupo 'Z' ni local: nada pasa el filtro de expenses/groups. Los
    // perfiles SÍ pasan igual (ninguno es local todavía), que es correcto:
    // el filtro de users depende de si el id ya es CONOCIDO, no del groupId.
    const r = acotarDeltaAlGrupo(deltaBase(), 'Z');
    expect(r.groups).toEqual([]);
    expect(r.expenses).toEqual([]);
  });

  it('caso feliz vacío: un delta sin nada de este grupo no rompe', () => {
    const vacio: SyncDelta = {
      version: 1, featureVersion: 2, fromUserId: 'x', timestamp: 0,
      groups: [], expenses: [], payments: [], users: [],
    };
    const r = acotarDeltaAlGrupo(vacio, 'A');
    expect(r).toMatchObject({ groups: [], expenses: [], payments: [], users: [], groupKeys: [], personal: [] });
  });
});

/**
 * Ronda 2 — QA Strong + verificador ciego RECHAZARON la primera entrega
 * (`engram/qa/T-132.md`, `engram/qa/T-132-verifier.md`). El filtro confiaba en
 * lo que el propio registro entrante DECLARABA (`groupId`, `expenseId`,
 * `memberIds`), pero el merge de abajo (`mergeByIdLevels`/`mergeByIdLWW`) une
 * por **`id`**, sin verificar esos campos contra nada. Estos tests reproducen
 * los tres ataques exactos de los veredictos, con el `id` ya existiendo
 * localmente bajo OTRO dueño.
 */
describe('ronda 2 — el filtro no confía en lo que declara el registro entrante', () => {
  beforeEach(limpiarStoresLocales);

  // Verificador, defecto 1.a: `{id:'eB', groupId:'A', rev:999, isDeleted:true}`
  // — el gasto `eB` YA es local, de B. Declarar `groupId:'A'` no alcanza para
  // robarlo y borrarlo por la puerta de A.
  it('un gasto cuyo id ya es local de OTRO grupo no se roba aunque declare groupId propio', () => {
    useExpenseStore.setState({ expenses: [
      { id: 'eB', groupId: 'B', description: 'de B', amount: 1, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
    ]});

    const delta = deltaBase();
    delta.expenses = [{
      id: 'eB', groupId: 'A', rev: 999, isDeleted: true, description: 'robado',
      amount: 1, currency: 'ARS', paidById: 'mallory', splitMode: 'equal', splits: [],
      category: 'food', date: 0, createdAt: 0, createdById: 'mallory', deletionVotes: [],
      updatedAt: 999_999,
    } as any];

    expect(acotarDeltaAlGrupo(delta, 'A').expenses).toEqual([]);
  });

  it('lo mismo para payments', () => {
    usePaymentStore.setState({ payments: [
      { id: 'pB', groupId: 'B', fromUserId: 'mallory', toUserId: 'victim', amount: 5,
        currency: 'ARS', date: 0, createdAt: 0, createdById: 'mallory', ...meta } as any,
    ]});

    const delta = deltaBase();
    delta.payments = [{
      id: 'pB', groupId: 'A', rev: 999, isDeleted: true, fromUserId: 'mallory',
      toUserId: 'victim', amount: 999, currency: 'ARS', date: 0, createdAt: 0,
      createdById: 'mallory', updatedAt: 999_999,
    } as any];

    expect(acotarDeltaAlGrupo(delta, 'A').payments).toEqual([]);
  });

  it('lo mismo para recurring', () => {
    useRecurringStore.setState({ recurring: [
      { id: 'rB', groupId: 'B', description: 'de B', amount: 1, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', memberIds: ['victim'], category: 'food',
        rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null,
        isActive: true, createdAt: 0, createdById: 'victim', ...meta } as any,
    ]});

    const delta = deltaBase();
    delta.recurring = [{
      id: 'rB', groupId: 'A', rev: 999, isDeleted: true, description: 'robado',
      amount: 1, currency: 'ARS', paidById: 'mallory', splitMode: 'equal',
      memberIds: ['mallory'], category: 'food', rule: { frequency: 'monthly', startDate: 0 },
      lastMaterializedAt: null, isActive: true, createdAt: 0, createdById: 'mallory',
      updatedAt: 999_999,
    } as any];

    expect(acotarDeltaAlGrupo(delta, 'A').recurring).toEqual([]);
  });

  // Un gasto de A recién llegado EN ESTE MISMO sobre también debe poder
  // recibir comentarios — no sólo los que ya son locales.
  it('un gasto de A nuevo en este sobre puede recibir comentario en el mismo sobre', () => {
    const delta = deltaBase();
    delta.expenses = [delta.expenses[0]!]; // sólo eA, nueva para el local
    delta.comments = [{ id: 'cNuevo', expenseId: 'eA', authorId: 'mallory', text: 'hola',
      createdAt: 0, ...meta } as any];

    expect(acotarDeltaAlGrupo(delta, 'A').comments!.map(c => c.id)).toEqual(['cNuevo']);
  });

  // Verificador, defecto 1.b: `{id:'cB', expenseId:'eA', rev:999, text:'HACK'}`
  // — `cB` YA es local, colgado de `eB` (gasto de B). Declarar `expenseId:'eA'`
  // (un gasto real de A) no alcanza para reescribirlo.
  it('un comentario cuyo id ya cuelga localmente de un gasto de OTRO grupo no se puede reasignar a A', () => {
    useExpenseStore.setState({ expenses: [
      { id: 'eB', groupId: 'B', description: 'de B', amount: 1, currency: 'ARS',
        paidById: 'victim', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
    ]});
    useCommentStore.setState({ comments: [
      { id: 'cB', expenseId: 'eB', authorId: 'victim', text: 'original', createdAt: 0, ...meta } as any,
    ]});

    const delta = deltaBase();
    delta.expenses = [delta.expenses[0]!]; // eA, real y de A
    delta.comments = [{ id: 'cB', expenseId: 'eA', rev: 999, text: 'HACK', authorId: 'mallory',
      createdAt: 0, updatedAt: 999_999, isDeleted: false } as any];

    expect(acotarDeltaAlGrupo(delta, 'A').comments).toEqual([]);
  });

  // Verificador, defecto 1.c: meter a `bob` en `A.memberIds` del PROPIO sobre
  // ya no alcanza — la autoridad de membresía es SÓLO el snapshot local
  // (previo a este sobre), nunca el `groups` que el mismo sobre declara.
  it('meter a un userId conocido en memberIds del PROPIO sobre no alcanza para sobrescribir su perfil', () => {
    useUserStore.setState({ users: [{ id: 'bob', name: 'Bob real', authProvider: 'google' } as any] });
    // Bob es conocido pero NO es miembro local de A (viene de otro grupo, B).

    const delta = deltaBase();
    delta.groups = [{ id: 'A', name: 'A', memberIds: ['victim', 'mallory', 'bob'], currency: 'ARS',
      createdAt: 0, createdById: 'mallory', deletionVotes: [], updatedAt: 999_999, isDeleted: false } as any];
    delta.users = [{ id: 'bob', name: 'BOB HACKEADO', email: 'evil@x' } as any];

    const r = acotarDeltaAlGrupo(delta, 'A');
    // El grupo A sí se actualiza (mismo trust boundary de siempre: un
    // co-miembro puede editar los datos DE SU PROPIO grupo) — lo que no pasa
    // es el perfil de Bob, ajeno a esta membresía hasta el próximo drenaje.
    expect(r.groups.map(g => g.id)).toEqual(['A']);
    expect(r.users.map(u => u.id)).not.toContain('bob');
  });

  it('un usuario NUEVO (no conocido en absoluto) SÍ puede entrar declarado en memberIds del sobre', () => {
    // Contraste con el caso anterior: acá no hay perfil previo que pisar.
    const delta = deltaBase();
    delta.groups = [{ id: 'A', name: 'A', memberIds: ['victim', 'mallory', 'carol'], currency: 'ARS',
      createdAt: 0, createdById: 'mallory', deletionVotes: [], updatedAt: 999_999, isDeleted: false } as any];
    delta.users.push({ id: 'carol', name: 'Carol' } as any);

    const r = acotarDeltaAlGrupo(delta, 'A');
    expect(r.users.map(u => u.id)).toContain('carol');
  });

  // Residual declarado y aceptado fuera de este ticket (arbitraje P-2 de
  // nerv-arquitecto, anexo de `engram/plans/T-132.md`): `mergeUsers` es LWW
  // sin tope de reloj, así que un perfil con `updatedAt` en el futuro gana y
  // queda envenenado de forma permanente. El fix va en `mergeUsers`, no acá.
  it.todo('T-137: perfil con updatedAt futuro no gana (ADR-012)');
});
