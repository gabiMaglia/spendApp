import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, LeaveRequest, User } from '@/src/types/models';

/** El pedido de salida visto desde el grupo: aprobarlo o retirarlo. */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;
const CARO = { id: 'caro', name: 'Caro', isDeleted: false } as User;

const pedidoDeAna = (approvedBy: string[] = []): LeaveRequest => ({
  userId: 'ana',
  plan: [{ fromUserId: 'ana', toUserId: 'beto', amount: 500_000, currency: 'ARS' }],
  requestedAt: 1_000,
  approvedBy,
});

const grupo = (leaveRequest?: LeaveRequest, memberIds = ['ana', 'beto', 'caro']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS', createdAt: 0,
  createdById: 'beto', deletionVotes: [], updatedAt: 0, isDeleted: false, leaveRequest,
} as Group);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useUserStore.setState({ users: [ANA, BETO, CARO] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('pedido de salida ajeno', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: BETO });
    useGroupStore.setState({ groups: [grupo(pedidoDeAna())] });
  });

  // Aprobar a ciegas no es aprobar: hay que saber quién y cuántos faltan.
  it('dice quién quiere salir y cuántos aprobaron', () => {
    const r = render(<GroupDetailScreen />);

    expect(r.getByText(/leave.pending_title/)).toBeTruthy();
    expect(r.getByText(/"got":0,"need":2/)).toBeTruthy();
  });

  it('aprobar suma mi firma', () => {
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByText('leave.approve'));

    expect(useGroupStore.getState().getById('g1')!.leaveRequest!.approvedBy).toEqual(['beto']);
  });

  it('ya habiendo aprobado, no se ofrece aprobar de nuevo', () => {
    useGroupStore.setState({ groups: [grupo(pedidoDeAna(['beto']))] });

    expect(render(<GroupDetailScreen />).queryByText('leave.approve')).toBeNull();
  });

  // Con la última firma, la salida se aplica sola: el reparto se convierte en
  // pagos y el que se iba deja de ser miembro.
  it('la última aprobación aplica el reparto', () => {
    useGroupStore.setState({ groups: [grupo(pedidoDeAna(['caro']))] });

    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByText('leave.approve'));

    const g = useGroupStore.getState().getById('g1')!;
    expect(g.memberIds).not.toContain('ana');
    expect(g.leaveRequest).toBeUndefined();
    expect(usePaymentStore.getState().payments).toHaveLength(1);
  });
});

describe('mi propio pedido', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: ANA });
    useGroupStore.setState({ groups: [grupo(pedidoDeAna(['beto']))] });
  });

  it('veo el avance, no el botón de aprobar', () => {
    const r = render(<GroupDetailScreen />);

    expect(r.getByText(/leave.pending_mine/)).toBeTruthy();
    expect(r.queryByText('leave.approve')).toBeNull();
  });

  it('puedo retirarlo', () => {
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByText('leave.withdraw'));

    expect(useGroupStore.getState().getById('g1')!.leaveRequest).toBeUndefined();
  });
});
