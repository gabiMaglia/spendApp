import { applyApprovedLeaves } from '../applyLeave';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import type { Group, LeaveRequest, User } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'd' }));

/**
 * Irse debiendo no es gratis: esa plata la pierde alguien. El reparto se
 * materializa como PAGOS, que es lo que el resto de la app ya sabe tratar.
 */

const AHORA = Date.UTC(2026, 7, 19, 12);

const pedido = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  userId: 'ana',
  plan: [{ fromUserId: 'ana', toUserId: 'beto', amount: 500_000, currency: 'ARS' }],
  requestedAt: 1_000,
  approvedBy: ['beto'],
  ...over,
});

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  leaveRequest: pedido(), ...over,
} as Group);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('payments').clearAll();
  useAuthStore.setState({ currentUser: { id: 'beto' } as User });
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
});

describe('aplicar una salida aprobada', () => {
  it('crea los pagos del reparto', () => {
    expect(applyApprovedLeaves(AHORA)).toBe(1);

    const pagos = usePaymentStore.getState().payments;
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({
      groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500_000,
    });
  });

  it('saca del grupo al que se va', () => {
    applyApprovedLeaves(AHORA);

    expect(useGroupStore.getState().getById('g1')!.memberIds).toEqual(['beto']);
  });

  it('limpia el pedido', () => {
    applyApprovedLeaves(AHORA);

    expect(useGroupStore.getState().getById('g1')!.leaveRequest).toBeUndefined();
  });

  /**
   * Los ids de los pagos son nuevos cada vez, así que aplicar dos veces
   * DUPLICARÍA el reparto. Limpiar el pedido es lo que lo hace idempotente, y
   * por eso va en la misma operación y no en un paso aparte.
   */
  it('aplicarla dos veces no duplica los pagos', () => {
    applyApprovedLeaves(AHORA);
    expect(applyApprovedLeaves(AHORA)).toBe(0);

    expect(usePaymentStore.getState().payments).toHaveLength(1);
  });
});

describe('lo que NO se aplica', () => {
  it('sin todas las aprobaciones no pasa nada', () => {
    useGroupStore.setState({ groups: [grupo({
      memberIds: ['ana', 'beto', 'caro'],
      leaveRequest: pedido({ approvedBy: ['beto'] }),
    })] });

    expect(applyApprovedLeaves(AHORA)).toBe(0);
    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain('ana');
  });

  it('un grupo sin pedido no se toca', () => {
    useGroupStore.setState({ groups: [grupo({ leaveRequest: undefined })] });

    expect(applyApprovedLeaves(AHORA)).toBe(0);
  });

  it('un grupo borrado tampoco', () => {
    useGroupStore.setState({ groups: [grupo({ isDeleted: true })] });

    expect(applyApprovedLeaves(AHORA)).toBe(0);
  });

  it('procesa varios grupos de una', () => {
    useGroupStore.setState({ groups: [grupo(), grupo({ id: 'g2' })] });

    expect(applyApprovedLeaves(AHORA)).toBe(2);
    expect(usePaymentStore.getState().payments).toHaveLength(2);
  });
});
