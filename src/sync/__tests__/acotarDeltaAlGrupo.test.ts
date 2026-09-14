import { acotarDeltaAlGrupo } from '../acotarDeltaAlGrupo';
import { useGroupStore } from '@/src/store/groupStore';
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

describe('acotarDeltaAlGrupo — el receptor sólo aplica lo del grupo del topic', () => {
  beforeEach(() => {
    useGroupStore.setState({ groups: [] });
  });

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

  it('usuarios: sólo miembros del grupo según el delta entrante o el local', () => {
    const r = acotarDeltaAlGrupo(deltaBase(), 'A');
    expect(r.users.map(u => u.id).sort()).toEqual(['mallory', 'victim']);
  });

  it('un miembro nuevo (recién agregado en el delta) sigue viendo su propio perfil', () => {
    const delta = deltaBase();
    delta.groups[0]!.memberIds = ['victim', 'mallory', 'nuevo'];
    delta.users.push({ id: 'nuevo', name: 'Nuevo' } as any);

    const r = acotarDeltaAlGrupo(delta, 'A');
    expect(r.users.map(u => u.id).sort()).toEqual(['mallory', 'nuevo', 'victim']);
  });

  it('unión con la membresía LOCAL: un miembro que el delta no repite igual pasa', () => {
    useGroupStore.setState({ groups: [
      { id: 'A', name: 'A', memberIds: ['victim', 'mallory', 'local-only'], currency: 'ARS',
        createdAt: 0, createdById: 'victim', deletionVotes: [], ...meta } as any,
    ]});
    const delta = deltaBase();
    delta.users.push({ id: 'local-only', name: 'Local' } as any);

    const r = acotarDeltaAlGrupo(delta, 'A');
    expect(r.users.map(u => u.id)).toContain('local-only');
  });

  it('grupo desconocido (sin registro local ni en el delta): no filtra por miembros inventados', () => {
    // No hay grupo 'Z' ni local ni en el delta: nada pasa el filtro de users.
    const r = acotarDeltaAlGrupo(deltaBase(), 'Z');
    expect(r.groups).toEqual([]);
    expect(r.expenses).toEqual([]);
    expect(r.users).toEqual([]);
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
