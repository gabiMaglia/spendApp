jest.mock('@/src/sync/trustCheck', () => ({ checkRecord: jest.fn(() => 'no_verificable') }));
import { checkRecord } from '@/src/sync/trustCheck';
import { noticesFor, snapshot } from '../syncNotices';
import type { Group, Payment } from '@/src/types/models';

const NOW = 1_800_000_000_000;
const g = { id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  deletionMode: 'consensus', createdAt: 0, createdById: 'ana', deletionVotes: [],
  updatedAt: 0, isDeleted: false } as Group;
const forjado = { id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', createdById: 'beto',
  amount: 500, currency: 'ARS', date: 1, createdAt: 1, updatedAt: 1, isDeleted: false } as Payment;

it('T-170.4: el acreedor recibe settlement_pending por un pago forjado a su nombre (G5)', () => {
  const antes = snapshot([], NOW, [g], []);
  const avisos = noticesFor(antes, [], [g], 'beto', NOW, [forjado]);
  expect(avisos.map(a => a.kind)).toContain('settlement_pending');
});

it('un pago propio con firma válida sigue sin avisarse (lo cargué yo)', () => {
  (checkRecord as jest.Mock).mockReturnValueOnce('valida');
  const antes = snapshot([], NOW, [g], []);
  expect(noticesFor(antes, [], [g], 'beto', NOW, [forjado])).toEqual([]);
});
