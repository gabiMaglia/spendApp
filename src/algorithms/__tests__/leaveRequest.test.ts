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

/**
 * T-181 (8.4, repaso 2026-09-27): `approversNeeded` pasaba de «todos los que
 * quedan» a «los que figuran en el `plan` como `fromUserId`/`toUserId`,
 * distintos del que se va». Antes, un miembro que había desinstalado la app
 * dejaba trabado para siempre a quien quería irse: tenía que aprobar alguien
 * que ni siquiera absorbía ni cobraba nada del reparto.
 */
const pago = (
  fromUserId: string, toUserId: string, amount = 100,
): LeaveRequest['plan'][number] => ({ fromUserId, toUserId, amount, currency: 'ARS' });

describe('quiénes tienen que aprobar (T-181: sólo los del plan)', () => {
  it('L1: un plan con un solo absorbente → sólo él es necesario', () => {
    const g = grupo(['ana', 'beto', 'caro', 'dani']);
    const plan = [pago('ana', 'beto')];
    expect(approversNeeded(g, 'ana', plan)).toEqual(['beto']);
  });

  it('L2: plan con dos absorbentes → los dos; el resto no cuenta, need=2', () => {
    const g = grupo(['ana', 'beto', 'caro', 'dani']);
    const plan = [pago('ana', 'beto', 50), pago('ana', 'caro', 50)];
    expect(approversNeeded(g, 'ana', plan)).toEqual(['beto', 'caro']);
    expect(approvalProgress(g, pedido({ plan, approvedBy: ['beto'] })))
      .toEqual({ got: 1, need: 2 });
  });

  it('L3: plan vacío → nadie necesario (el camino de saldo cero sale por leaveGroup directo, sin pedido — no cambia)', () => {
    const g = grupo(['ana', 'beto', 'caro']);
    expect(approversNeeded(g, 'ana', [])).toEqual([]);
    expect(isApprovedByAll(g, pedido({ plan: [] }))).toBe(false); // sin cambios, documentado
  });

  it('L4: un absorbente del plan que ya no está en memberIds no se le exige', () => {
    const g = grupo(['ana', 'caro']); // beto ya no está en el grupo
    const plan = [pago('ana', 'beto')];
    expect(approversNeeded(g, 'ana', plan)).toEqual([]);
    // Caso abierto (anotado en el ticket, no resuelto acá): si nadie queda a
    // quien exigirle, `isApprovedByAll` sigue devolviendo `false`
    // (`necesarios.length === 0`) — el pedido queda trabado sin nadie que lo
    // pueda aprobar. Documentado, no arreglado en T-181.
    expect(isApprovedByAll(g, pedido({ plan, approvedBy: [] }))).toBe(false);
  });

  it('L5: una firma de alguien NO involucrado no cuenta ni estorba', () => {
    const g = grupo(['ana', 'beto', 'caro', 'dani']);
    const plan = [pago('ana', 'beto')];
    expect(isApprovedByAll(g, pedido({ plan, approvedBy: ['dani'] }))).toBe(false);
    expect(isApprovedByAll(g, pedido({ plan, approvedBy: ['dani', 'beto'] }))).toBe(true);
  });

  it('D no cuenta cuando el plan sólo involucra a B y C (mismo caso de L2, otro ángulo)', () => {
    const g = grupo(['ana', 'beto', 'caro', 'dani']);
    const plan = [pago('ana', 'beto', 50), pago('ana', 'caro', 50)];
    expect(isApprovedByAll(g, pedido({ plan, approvedBy: ['beto', 'caro'] }))).toBe(true);
    expect(approversNeeded(g, 'ana', plan)).not.toContain('dani');
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
