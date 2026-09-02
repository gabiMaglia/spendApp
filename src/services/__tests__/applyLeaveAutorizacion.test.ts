import { ed25519 } from '@noble/curves/ed25519.js';
import { applyApprovedLeaves } from '../applyLeave';
import { signLeaveApproval } from '@/src/sync/leaveApprovalSign';
import { toHex } from '@/src/sync/hexBytes';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { Group, LeaveApproval, LeaveRequest } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const PRIV: Record<string, string> = { beto: 'b'.repeat(64), caro: 'c'.repeat(64) };
const PUB = Object.fromEntries(
  Object.entries(PRIV).map(([k, v]) => [k, toHex(ed25519.getPublicKey(Buffer.from(v, 'hex')))]),
);

// El directorio de claves: cada uno con la suya, que es el caso real. Todo se
// resuelve ADENTRO de la factory —jest no deja mirar afuera— y el prefijo
// `mock` es lo único que jest permite referenciar desde acá.
jest.mock('@/src/sync/authorKeys', () => ({
  authorKeysFor: (userId: string) => {
    const { ed25519: curva } = require('@noble/curves/ed25519.js');
    const hex = (b: Uint8Array) =>
      [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    const semilla: Record<string, string> = { beto: 'b'.repeat(64), caro: 'c'.repeat(64) };
    if (!semilla[userId]) return [];
    return [hex(curva.getPublicKey(Buffer.from(semilla[userId], 'hex')))];
  },
}));

const PLAN = [{ fromUserId: 'beto', toUserId: 'caro', amount: 500_000, currency: 'ARS' as const }];

const pedido = (approvedBy: LeaveRequest['approvedBy']): LeaveRequest =>
  ({ userId: 'ana', requestedAt: 1_000, plan: PLAN, approvedBy, v: 2 });

const grupo = (req: LeaveRequest): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto', 'caro'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  leaveRequest: req,
} as Group);

function firmada(userId: 'beto' | 'caro', req: LeaveRequest): LeaveApproval {
  const a: LeaveApproval = { userId, approvedAt: 2_000 };
  return { ...a, ...signLeaveApproval('g1', req, a, PRIV[userId]) };
}

beforeEach(() => usePaymentStore.setState({ payments: [] }));

/**
 * **Acá la firma AUTORIZA, no informa.**
 *
 * `applyApprovedLeaves` corre al arrancar y después de CADA sync, en el teléfono
 * de todos, y materializa pagos que mueven saldo. No hay nadie mirando cuando
 * pasa: si acá no se verifica, no se verifica en ningún lado que importe.
 *
 * Una mutación que le sacaba la verificación a esta llamada dejaba las 240
 * pruebas de servicios y pantallas en verde. Este archivo existe por eso.
 */
describe('la salida no se aplica sin autorización real', () => {
  it('con aprobaciones forjadas NO se mueve un peso', () => {
    const req = pedido(['beto', 'caro']);   // ids pelados, escritos por quien se va
    useGroupStore.setState({ groups: [grupo(req)] });

    expect(applyApprovedLeaves(5_000)).toBe(0);
    expect(usePaymentStore.getState().payments).toHaveLength(0);
    // Y Ana sigue en el grupo: la salida no ocurrió.
    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain('ana');
  });

  it('con una sola firma legítima de dos, tampoco', () => {
    const base = pedido([]);
    useGroupStore.setState({ groups: [grupo(pedido([firmada('beto', base), 'caro']))] });

    expect(applyApprovedLeaves(5_000)).toBe(0);
    expect(usePaymentStore.getState().payments).toHaveLength(0);
  });

  it('con las dos firmas legítimas, la salida se aplica', () => {
    const base = pedido([]);
    useGroupStore.setState({
      groups: [grupo(pedido([firmada('beto', base), firmada('caro', base)]))],
    });

    expect(applyApprovedLeaves(5_000)).toBe(1);
    expect(usePaymentStore.getState().payments).toHaveLength(1);
    expect(useGroupStore.getState().getById('g1')!.memberIds).not.toContain('ana');
  });

  // Compatibilidad: una salida ya en curso antes de T-065 no se traba.
  it('un pedido anterior a T-065 se sigue aplicando sin firmas', () => {
    useGroupStore.setState({
      groups: [grupo({ ...pedido(['beto', 'caro']), v: undefined })],
    });

    expect(applyApprovedLeaves(5_000)).toBe(1);
    expect(usePaymentStore.getState().payments).toHaveLength(1);
  });
});
