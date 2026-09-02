import { normalizarAprobacion } from '@/src/sync/leaveApprovalCore';
import { approversNeeded, isApprovedByAll, approvalProgress, mergeApprovals } from '../leaveRequest';
import type { Group, LeaveRequest } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

const grupo = (memberIds: string[], leaveRequest?: LeaveRequest): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS', createdAt: 0,
  createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, leaveRequest,
} as Group);

const pedido = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  userId: 'ana', plan: [], requestedAt: 1_000, approvedBy: [], ...over,
});

describe('quiénes tienen que aprobar', () => {
  it('todos los que quedan, no el que se va', () => {
    expect(approversNeeded(grupo(['ana', 'beto', 'caro']), 'ana')).toEqual(['beto', 'caro']);
  });

  it('faltando uno, no alcanza', () => {
    const g = grupo(['ana', 'beto', 'caro']);
    expect(isApprovedByAll(g, pedido({ approvedBy: ['beto'] }))).toBe(false);
  });

  it('con todos, sí', () => {
    const g = grupo(['ana', 'beto', 'caro']);
    expect(isApprovedByAll(g, pedido({ approvedBy: ['beto', 'caro'] }))).toBe(true);
  });

  // Sin nadie a quien pasarle el saldo, aprobar no significa nada.
  it('si no queda nadie, nunca está aprobado', () => {
    expect(isApprovedByAll(grupo(['ana']), pedido())).toBe(false);
  });

  it('el avance se cuenta sobre los necesarios, no sobre las firmas', () => {
    const g = grupo(['ana', 'beto', 'caro']);
    // Una firma de alguien que ya no está en el grupo no debería contar.
    expect(approvalProgress(g, pedido({ approvedBy: ['beto', 'fantasma'] })))
      .toEqual({ got: 1, need: 2 });
  });
});

/**
 * El `Group` se mergea por LWW, así que si dos personas aprueban cada una en su
 * teléfono antes de sincronizar, el registro con `updatedAt` menor se descarta
 * ENTERO y esa aprobación desaparece. Nadie se entera: el pedido simplemente
 * nunca junta las firmas que necesita.
 */
describe('unir aprobaciones sin perder ninguna', () => {
  it('dos aprobaciones en paralelo sobreviven las dos', () => {
    const a = pedido({ approvedBy: ['beto'] });
    const b = pedido({ approvedBy: ['caro'] });

    expect(mergeApprovals(a, b)!.approvedBy.sort()).toEqual(['beto', 'caro']);
  });

  it('no duplica al que aprobó en los dos lados', () => {
    const a = pedido({ approvedBy: ['beto'] });
    const b = pedido({ approvedBy: ['beto', 'caro'] });

    expect(mergeApprovals(a, b)!.approvedBy.sort()).toEqual(['beto', 'caro']);
  });

  // Aprobaron OTRO plan: arrastrar esas firmas sería darlas por válidas para un
  // reparto que esas personas nunca vieron.
  it('si son rondas distintas gana la más nueva y NO se arrastran firmas', () => {
    const vieja = pedido({ requestedAt: 1_000, approvedBy: ['beto', 'caro'] });
    const nueva = pedido({ requestedAt: 2_000, approvedBy: [] });

    expect(mergeApprovals(vieja, nueva)).toEqual(nueva);
    expect(mergeApprovals(nueva, vieja)).toEqual(nueva);
  });

  it('un pedido de otra persona no se mezcla con el mío', () => {
    const mio  = pedido({ userId: 'ana',  requestedAt: 1_000, approvedBy: ['beto'] });
    const otro = pedido({ userId: 'beto', requestedAt: 1_000, approvedBy: ['caro'] });

    expect(mergeApprovals(mio, otro)!.approvedBy).toEqual(['beto']);
  });

  it('tolera que falte de un lado', () => {
    const a = pedido({ approvedBy: ['beto'] });
    expect(mergeApprovals(a, undefined)).toEqual(a);
    expect(mergeApprovals(undefined, a)).toEqual(a);
    expect(mergeApprovals(undefined, undefined)).toBeUndefined();
  });
});

describe('el store de grupos', () => {
  // La UI esconde el botón después de aprobar, pero el store no puede confiar
  // en eso: un aviso que llega dos veces por sync llamaría a `approveLeave` de
  // nuevo, y una firma duplicada haría que el avance diga "3 de 2".
  it('aprobar dos veces no duplica la firma', () => {
    const { useGroupStore } = jest.requireActual('@/src/store/groupStore') as typeof import('@/src/store/groupStore');

    useGroupStore.setState({ groups: [grupo(['ana', 'beto'], pedido())] });
    useGroupStore.getState().approveLeave('g1', 'beto');
    useGroupStore.getState().approveLeave('g1', 'beto');

    // Desde T-065 la aprobación es un objeto FIRMADO, no un id pelado. Lo que
    // este test cuida sigue siendo lo mismo: aprobar dos veces deja UNA.
    const cs = useGroupStore.getState().getById('g1')!.leaveRequest!.approvedBy;
    expect(cs).toHaveLength(1);
    expect(normalizarAprobacion(cs[0]).userId).toBe('beto');
  });
});
